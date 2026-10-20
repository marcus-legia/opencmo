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
from ..media.ffmpeg import USER_INPUT, FFmpegError, run
from ..models import Transcript, TranscriptSegment, Word

log = logging.getLogger(__name__)

_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text"
_TIMEOUT = httpx.Timeout(300.0, connect=15.0)
# Scribe accepts far larger files; this cap keeps the upload short so a long video transcribes
# in one request (32 kbps mono fits ~100 minutes).
TRANSCRIBE_MAX_BYTES = 24 * 1024 * 1024

# A new segment starts after a sentence ends or after a pause, so captions
# get sentence-sized lines like the old Whisper segments.
_SENTENCE_END = (".", "?", "!", "…", "。", "？", "！")
_PAUSE_SECONDS = 0.8
_MAX_SEGMENT_SECONDS = 12.0

# Scribe takes about 40 s for 54 minutes in one call (measured 11/10). Parts of this length are
# sent at once, so the transcript waits for one part. Each part is cut a little before its own
# start and runs a little past the next one, so a word on a cut is heard whole by both parts;
# it is kept only by the part whose window holds its start, so it is neither lost nor doubled.
# A part that began mid-word hears only a fragment, and that fragment falls before its window.
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


def cut_start(start: float) -> float:
    """Where the part whose window begins at `start` is cut: one overlap earlier."""
    return max(0.0, start - _CHUNK_OVERLAP)


def _first_packet(path: Path) -> float:
    proc = run([
        "ffprobe", "-v", "error", *USER_INPUT, "-select_streams", "a:0", "-read_intervals", "%+#1",
        "-show_entries", "packet=pts_time", "-of", "csv=p=0", str(path),
    ], timeout=60)
    return float(proc.stdout.split()[0].strip(","))


def _cut_part(audio_path: Path, start: float, workdir: Path, index: int) -> tuple[Path, float]:
    """The part for the window at `start`, and the source second its first sample is at.

    Stream copy, `-ss` before `-i`: a part costs a fraction of a second, where re-encoding six
    10-minute parts took 6-9 s. A copy starts at the container's seek point at or before `-ss`
    (a WebM cluster, up to seconds early), so the real start is read back from the packets
    (`-copyts` keeps source time), then the part is remuxed to start at 0 so Scribe's times and
    the file agree whether a decoder honours timestamps or counts samples.
    """
    cut = cut_start(start)
    raw = workdir / f"raw{index}{audio_path.suffix}"
    part = workdir / f"part{index}{audio_path.suffix}"
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *USER_INPUT, "-ss", f"{cut:.3f}",
        # With `-copyts` output times are source times: the end is `-to`, not a `-t` length.
        "-i", str(audio_path), "-to", f"{start + CHUNK_SECONDS + _CHUNK_OVERLAP:.3f}",
        "-vn", "-c", "copy", "-copyts", str(raw),
    ], timeout=120)
    try:
        first = _first_packet(raw)
    except (FFmpegError, ValueError, IndexError) as exc:
        raise RuntimeError("Could not read the audio to transcribe.") from exc
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *USER_INPUT, "-i", str(raw),
        "-c", "copy", "-avoid_negative_ts", "make_zero", str(part),
    ], timeout=120)
    return part, first


def merge_parts(parts: list[tuple[float, float, list[Word]]]) -> list[Word]:
    """`(window start, source second of the part's first sample, words)` per part: shifts the
    words to source time and keeps a word in the part whose window `[start, next start)` holds
    its start."""
    merged: list[Word] = []
    for index, (start, offset, words) in enumerate(parts):
        end = parts[index + 1][0] if index + 1 < len(parts) else float("inf")
        for word in words:
            at = word.start + offset
            if start <= at < end:
                merged.append(Word(start=at, end=word.end + offset, text=word.text))
    return merged


def transcribe_audio(audio_path: Path, cfg: Config) -> Transcript:
    cfg.validate_for_transcribe()

    size = audio_path.stat().st_size
    if size > TRANSCRIBE_MAX_BYTES:
        # Fixed prefix: `worker/errors.py` maps it to a sentence for the user.
        raise RuntimeError(f"Audio is too large to transcribe: {size} bytes.")

    duration = _duration(audio_path)
    if not duration:
        # Fail closed: without a length the part cap cannot hold, and audio ffprobe cannot read
        # is not worth a paid call. Fixed prefix: `worker/errors.py` maps it.
        raise RuntimeError("Could not read the audio to transcribe.")
    starts = chunk_starts(duration)
    if len(starts) > MAX_PARTS:
        raise RuntimeError(f"Audio is too large to transcribe: {duration:.0f} seconds.")
    if len(starts) == 1:
        payload = _post(audio_path, cfg)
        words = _words(payload)
        languages = [payload.get("language_code")]
    else:
        with tempfile.TemporaryDirectory(prefix="opencmo-scribe-") as tmp:

            def cut_and_post(index: int, start: float) -> tuple[float, dict]:
                # Cut inside the pool: each part is sent as soon as it is ready.
                part, offset = _cut_part(audio_path, start, Path(tmp), index)
                return offset, _post(part, cfg)

            with ThreadPoolExecutor(max_workers=min(_MAX_PARALLEL_PARTS, len(starts))) as pool:
                results = list(pool.map(cut_and_post, range(len(starts)), starts))
        payloads = [payload for _offset, payload in results]
        words = merge_parts([
            (start, offset, _words(payload)) for start, (offset, payload) in zip(starts, results, strict=True)
        ])
        languages = [payload.get("language_code") for payload in payloads]
        log.info("Transcribed %d parts of %.0f s in parallel", len(starts), CHUNK_SECONDS)

    segments = segments_from_words(words)

    # Music without words, montages and silent footage can return no segments. That is a valid
    # result: the pipeline picks a fallback window and renders without captions.
    log.info("Transcribed: %d segments", len(segments))
    known = [str(code).lower() for code in languages if code]
    code = max(set(known), key=known.count) if known else "en"
    return Transcript(segments=segments, language=_LANGUAGES.get(code, code), source="scribe")
