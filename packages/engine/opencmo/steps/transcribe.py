"""Transcript through ElevenLabs Scribe.

Why an API rather than local Whisper: on CPU local Whisper takes minutes, uses 1–10 GB of RAM
and competes with ffmpeg for cores, which breaks the per-job budgets. Scribe returns word-level
timestamps in one call; segments are rebuilt from the words here.
"""

from __future__ import annotations

import json
import logging
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from ..config import Config
from ..media.ffmpeg import USER_INPUT, run
from ..models import Transcript, TranscriptSegment, Word

log = logging.getLogger(__name__)

_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text"
_TIMEOUT = httpx.Timeout(300.0, connect=15.0)
# Scribe accepts far larger files; this cap keeps the upload short so the "45 minutes -> 5 clips
# in under 3 minutes" budget holds (32 kbps mono fits ~100 minutes).
TRANSCRIBE_MAX_BYTES = 24 * 1024 * 1024

# A new segment starts after a sentence ends or after a pause, so captions and moment
# selection get sentence-sized lines like the old Whisper segments.
_SENTENCE_END = (".", "?", "!", "…", "。", "？", "！")
_PAUSE_SECONDS = 0.8
_MAX_SEGMENT_SECONDS = 12.0

# Scribe takes about 40 s for 54 minutes in one call (measured 11/10). Parts of this length are
# sent at once, so the transcript waits for one part. Each part runs a little past the next
# start and words are kept by start time, so a word on a cut is neither lost nor doubled.
CHUNK_SECONDS = 600.0
_CHUNK_OVERLAP = 2.0
_MAX_PARALLEL_PARTS = 6
#: 3 hours. The byte cap alone does not bound the duration (a low bitrate stretches 24 MB), and
#: every part is a paid call: longer audio is refused like an oversized file.
MAX_PARTS = 18
_MIME = {".m4a": "audio/mp4", ".mp4": "audio/mp4", ".webm": "audio/webm", ".mp3": "audio/mpeg"}

# Scribe answers ISO 639-3; the rest of the engine uses two-letter codes like subtitles do.
_LANGUAGES = {
    "eng": "en", "vie": "vi", "spa": "es", "fra": "fr", "deu": "de", "por": "pt", "ita": "it",
    "jpn": "ja", "kor": "ko", "zho": "zh", "cmn": "zh", "rus": "ru", "hin": "hi", "ind": "id",
    "tha": "th", "ara": "ar", "nld": "nl", "pol": "pl", "tur": "tr", "ukr": "uk",
}


def _words(payload: dict) -> list[Word]:
    words: list[Word] = []
    for raw in payload.get("words") or []:
        if raw.get("type", "word") != "word":
            continue
        text = str(raw.get("text", "")).strip()
        if not text:
            continue
        start = float(raw.get("start", 0.0))
        words.append(Word(start=start, end=max(start, float(raw.get("end", start))), text=text))
    return words


def segments_from_words(words: list[Word]) -> list[TranscriptSegment]:
    """Groups words into sentence-sized segments; every segment keeps its words."""
    segments: list[TranscriptSegment] = []
    current: list[Word] = []

    def close() -> None:
        if current:
            segments.append(TranscriptSegment(
                start=current[0].start,
                end=current[-1].end,
                text=" ".join(word.text for word in current),
                words=list(current),
            ))
            current.clear()

    for word in words:
        if current and (
            word.start - current[-1].end > _PAUSE_SECONDS
            or word.end - current[0].start > _MAX_SEGMENT_SECONDS
        ):
            close()
        current.append(word)
        if word.text.endswith(_SENTENCE_END):
            close()
    close()
    return segments


def _post(audio_path: Path, cfg: Config) -> dict:
    with audio_path.open("rb") as fh:
        response = httpx.post(
            _ENDPOINT,
            headers={"xi-api-key": cfg.elevenlabs_api_key},
            files={"file": (audio_path.name, fh, _MIME.get(audio_path.suffix.lower(), "audio/mp4"))},
            data={
                "model_id": cfg.scribe_model,
                "timestamps_granularity": "word",
                "tag_audio_events": "false",
            },
            timeout=_TIMEOUT,
        )
    if response.status_code != 200:
        raise RuntimeError(
            f"Speech-to-text returned {response.status_code}: {response.text[:300]}"
        )
    return response.json()


def _duration(path: Path) -> float | None:
    """Seconds of audio, or None when ffprobe cannot read it (then it is sent in one part)."""
    try:
        # The audio comes from the user's file or a link: never let ffprobe follow a playlist.
        proc = run(["ffprobe", "-v", "error", *USER_INPUT, "-show_entries", "format=duration", "-of", "json", str(path)], timeout=60)
        return float(json.loads(proc.stdout)["format"]["duration"])
    except Exception:  # noqa: BLE001 - an unreadable duration only turns chunking off
        return None


def chunk_starts(duration: float, chunk: float | None = None) -> list[float]:
    """Start of each part; one part when the audio is short."""
    chunk = chunk or CHUNK_SECONDS
    count = max(1, int(-(-duration // chunk)))
    return [index * chunk for index in range(count)]


def merge_parts(parts: list[tuple[float, list[Word]]]) -> list[Word]:
    """Shifts each part's words to source time and keeps a word in the part where it starts."""
    merged: list[Word] = []
    for index, (start, words) in enumerate(parts):
        end = parts[index + 1][0] if index + 1 < len(parts) else float("inf")
        for word in words:
            at = word.start + start
            if start <= at < end:
                merged.append(Word(start=at, end=word.end + start, text=word.text))
    return merged


def transcribe_audio(audio_path: Path, cfg: Config) -> Transcript:
    cfg.validate_for_transcribe()

    size = audio_path.stat().st_size
    if size > TRANSCRIBE_MAX_BYTES:
        # Fixed prefix: `worker/errors.py` maps it to a sentence for the user.
        raise RuntimeError(f"Audio is too large to transcribe: {size} bytes.")

    duration = _duration(audio_path)
    starts = chunk_starts(duration) if duration else [0.0]
    if len(starts) > MAX_PARTS:
        raise RuntimeError(f"Audio is too large to transcribe: {duration:.0f} seconds.")
    if len(starts) == 1:
        payload = _post(audio_path, cfg)
        words = _words(payload)
        languages = [payload.get("language_code")]
    else:
        with tempfile.TemporaryDirectory(prefix="opencmo-scribe-") as tmp:
            paths = []
            for index, start in enumerate(starts):
                part = Path(tmp) / f"part{index}{audio_path.suffix}"
                # Stream copy, `-ss` before `-i`: cutting a 54-minute file costs a second.
                run([
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *USER_INPUT, "-ss", f"{start:.3f}",
                    "-i", str(audio_path), "-t", f"{CHUNK_SECONDS + _CHUNK_OVERLAP:.3f}",
                    "-vn", "-c", "copy", str(part),
                ], timeout=120)
                paths.append(part)
            with ThreadPoolExecutor(max_workers=min(_MAX_PARALLEL_PARTS, len(paths))) as pool:
                payloads = list(pool.map(lambda path: _post(path, cfg), paths))
        words = merge_parts([(start, _words(payload)) for start, payload in zip(starts, payloads, strict=True)])
        languages = [payload.get("language_code") for payload in payloads]
        log.info("Transcribed %d parts of %.0f s in parallel", len(starts), CHUNK_SECONDS)

    segments = segments_from_words(words)

    # Music without words, montages and silent footage can return no segments. That is a valid
    # result: the pipeline picks a fallback window and renders without captions.
    log.info("Transcribed: %d segments", len(segments))
    known = [str(code).lower() for code in languages if code]
    code = max(set(known), key=known.count) if known else "en"
    return Transcript(segments=segments, language=_LANGUAGES.get(code, code), source="scribe")
