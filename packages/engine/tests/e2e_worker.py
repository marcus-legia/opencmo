"""Worker for the browser E2E: the real worker, except the calls to speech-to-text.

    SUPABASE_URL=http://127.0.0.1:54321 \\
    SUPABASE_SERVICE_ROLE_KEY=... \\
    packages/engine/.venv312/bin/python -m tests.e2e_worker

Why a SEPARATE file in `tests/` and not a flag in the worker: a "fake AI" flag in production code
would ship to the real servers, and one misset environment variable would give users a fake
transcript. Here it cannot be switched on by mistake — this file is not in the package.

Two safety catches: loopback Supabase only, and `OPENCMO_E2E=1` is required. Everything else —
probe, settle, the editor master, publication, preview, export, B-roll probes — runs the real
worker code; that is what E2E has to check.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from opencmo.backends.supabase import SupabaseStore
from opencmo.models import Transcript, TranscriptSegment, Word
from opencmo.worker import kinds, loop, process_job, transcribe_asset_task, transcribe_media_task

log = logging.getLogger("opencmo.e2e")

LOOPBACK = {"127.0.0.1", "localhost", "::1", "host.docker.internal"}


def _fixture_upload_transcript(audio: Path, cfg) -> Transcript:
    """Replaces Scribe for an upload: the audio must still come out of the real ffmpeg.

    The words let the editor try clicking a word and cutting a phrase — without them half of
    `clip-flow.spec.ts` has nothing to click.
    """
    assert audio.stat().st_size > 0
    words = [Word(0.4 + index * 0.4, 0.8 + index * 0.4, word) for index, word in enumerate(["we", "built", "this", "in", "a", "single", "weekend"])]
    return Transcript(segments=[TranscriptSegment(0.4, 3.6, "we built this in a single weekend", words)], language="en", source="whisper")


def _fixture_transcribe(audio: Path, cfg) -> Transcript:
    """Replaces speech-to-text for library file captions: the audio must still come out of ffmpeg."""
    assert audio.stat().st_size > 0
    words = [Word(0.2 + index * 0.4, 0.55 + index * 0.4, word) for index, word in enumerate(["b-roll", "has", "its", "own", "voice"])]
    return Transcript(segments=[TranscriptSegment(0.2, 2.15, "b-roll has its own voice", words)], language="en", source="whisper")


#: Sidecar transcripts for library fixtures: `<file name>.transcript.json` next to the e2e fixtures,
#: in the editor's transcript shape (`[{text, words: [{text, start, end}]}]`, file seconds).
FIXTURES = Path(__file__).resolve().parents[3] / "apps" / "web" / "e2e" / "fixtures"


def _fixture_file_transcript(asset: dict, audio: Path) -> Transcript:
    """Replaces Scribe for the automatic file transcript: a fixture's sidecar when it has one, so a
    spec can rely on known fillers, pauses and retakes; otherwise the library captions fixture."""
    assert audio.stat().st_size > 0
    if str(asset.get("name") or "").startswith("no-auto-"):
        # A file whose free automatic run failed: specs that test the PAID captions path use one,
        # otherwise they race this run and find the transcript already there (free).
        raise RuntimeError("fixture: no automatic transcript for this file")
    sidecar = FIXTURES / f"{asset.get('name') or ''}.transcript.json"
    if not sidecar.is_file():
        return _fixture_transcribe(audio, None)
    segments = [
        TranscriptSegment(
            float(segment["words"][0]["start"]),
            float(segment["words"][-1]["end"]),
            str(segment["text"]),
            [Word(float(word["start"]), float(word["end"]), str(word["text"])) for word in segment["words"]],
        )
        for segment in json.loads(sidecar.read_text(encoding="utf-8"))
        if segment.get("words")
    ]
    return Transcript(segments=segments, language="en", source="whisper")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if os.environ.get("OPENCMO_E2E") != "1":
        print("OPENCMO_E2E=1 is required. This file is for the test stack only.", file=sys.stderr)
        return 2

    url = os.environ.get("SUPABASE_URL", "")
    host = urlparse(url).hostname or ""
    if host not in LOOPBACK:
        print(
            f"SUPABASE_URL points at {host or '(empty)'} — the fixture worker only runs against a "
            "loopback Supabase, never real data.",
            file=sys.stderr,
        )
        return 2
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not service_role_key:
        print("SUPABASE_SERVICE_ROLE_KEY is missing.", file=sys.stderr)
        return 2

    process_job.transcribe_audio = _fixture_upload_transcript  # type: ignore[assignment]
    transcribe_media_task.transcribe_audio = _fixture_transcribe  # type: ignore[assignment]
    transcribe_asset_task.transcribe = _fixture_file_transcript  # type: ignore[assignment]

    loop.run_forever(
        lambda: SupabaseStore(url, service_role_key),
        # The same table as the real worker (task-kinds.json): a missing handler leaves Export
        # waiting forever with no error. Generate runs FakeProvider when run.ts sets
        # OPENCMO_AI_FAKE=1.
        {"job": process_job.process, **kinds.handlers()},
        poll_seconds=1,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
