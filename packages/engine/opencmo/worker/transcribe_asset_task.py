"""The free, automatic transcript of a file in a project library (docs/own-video-editing-build.md, A3).

`complete_media_probe` queues this task for every ready video or sound with an audio stream (within
the daily cap). It transcribes the WHOLE file once, in file seconds, and stores it in
`media_transcripts`; every clip that plays the file reuses it (`use_media_transcript`), so the
Assistant can cut the user's own recording by its words.

No credits are involved: a failure only marks the file `failed`, and the user can ask again.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from opencmo.backends.supabase import Task
from opencmo.config import Config
from opencmo.editing.subtitles import to_ds_transcript
from opencmo.media.ffmpeg import extract_audio
from opencmo.models import Transcript
from opencmo.steps.transcribe import transcribe_audio
from opencmo.worker.render_document_task import MAX_SOURCE_BYTES
from opencmo.worker.task_run import TaskContext, TaskError, run_task

# Shown in the app (English). No credits to refund.
FAILED = "Could not transcribe this file."
NO_AUDIO = "This file has no audio to transcribe."
GONE = "This file is no longer stored with this project."
TOO_LONG = "This file is too long to transcribe automatically."

#: Same cap as `captions_max_seconds()` in SQL.
MAX_SECONDS = 1800


class _UserError(TaskError):
    pass


def transcribe(asset: dict[str, Any], audio: Path) -> Transcript:
    """The speech-to-text step; the e2e harness replaces it with a fixture transcript."""
    return transcribe_audio(audio, Config())


def source_label(transcript: Transcript) -> str:
    return "scribe" if transcript.source == "scribe" else "fake"


def process(store: Any, task: Task) -> None:
    run_task(store, task, name="transcript", failed=FAILED, body=_run)


def _run(ctx: TaskContext) -> None:
    store, task = ctx.store, ctx.task
    if task.kind != "transcribe_asset" or not task.job_id or not task.asset_id:
        raise ValueError("Invalid transcribe_asset task")
    row = store.get_media_asset(task.asset_id)
    if (
        not row
        or row.get("user_id") != task.user_id
        or row.get("job_id") != task.job_id
        or row.get("status") != "ready"
        or not str(row.get("storage_path") or "").startswith("media/")
    ):
        raise _UserError(GONE)
    duration = float(row.get("duration") or 0.0)
    if duration <= 0:
        raise _UserError(NO_AUDIO)
    if duration > MAX_SECONDS:
        raise _UserError(TOO_LONG)

    path = str(row["storage_path"])
    source = ctx.root / f"source{Path(path).suffix or '.bin'}"
    store.download_object("media", path[len("media/"):], source, max_bytes=MAX_SOURCE_BYTES)
    audio = ctx.root / "audio.m4a"
    try:
        # A streaming ffmpeg subprocess: no frame ever enters Python (CLAUDE.md budgets).
        extract_audio(source, audio, start=0.0, duration=duration)
    except Exception as exc:
        raise _UserError(NO_AUDIO) from exc
    try:
        transcript = transcribe(row, audio)
    except RuntimeError as exc:
        if str(exc).startswith("Audio is too large"):
            raise _UserError(TOO_LONG) from exc
        if str(exc).startswith("Could not read the audio"):
            raise _UserError(NO_AUDIO) from exc
        raise
    # No speech is still an answer: an empty transcript marks the file done, not failed.
    body = to_ds_transcript(transcript.segments) if transcript.segments else "[]"
    ctx.complete(lambda: store.complete_media_transcript(task.id, task.attempt_id, body, source_label(transcript)))
