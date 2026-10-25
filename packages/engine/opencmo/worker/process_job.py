"""An uploaded video becomes one editable project: the whole video, its transcript, its master.

The clip pipeline (link downloads, AI moment selection, vertical clips) was removed with the
clipping tool (owner, 2026-10-20). A job now runs one path, in order:

1. probe the upload through a signed URL (header only) and refuse what the editor cannot hold;
2. settle the credits on the video's real length;
3. download the user's own upload once and remux it into the editor's master (`-c copy`, I/O
   not CPU, no frame enters Python);
4. measure where the speaker's face is (`steps/reframe.py`) so the editor's crop follows them;
5. transcribe the master's audio with Scribe so the user can cut by words at once;
6. publish ONE `full` clip with its starting settings, transcript and master in one
   transaction (`complete_job_publication`), so the editor opens it like any project.

State of a run lives in `job_context`, uploads and their cleanup in `job_uploads`.
"""

from __future__ import annotations

import json
import logging
import math
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from opencmo.backends.retry import PermanentError, TransientError
from opencmo.backends.supabase import (
    BUCKET,
    SOURCES_BUCKET,
    InsufficientCreditsError,
    Job,
    StaleAttemptError,
    storage_path,
)
from opencmo.config import Config
from opencmo.editing.models import default_settings, settings_hash
from opencmo.editing.subtitles import to_ds_transcript
from opencmo.media.ffmpeg import extract_audio
from opencmo.media.probe import probe_file
from opencmo.steps.reframe import ASPECTS, editor_focus, face_track, needs_tracking
from opencmo.steps.render import _safe_name, preview_head
from opencmo.steps.transcribe import transcribe_audio
from opencmo.worker.errors import UserMessageError, processing_error
from opencmo.worker.heartbeat import Heartbeat
from opencmo.worker.job_context import STALE_ATTEMPT, JobRun
from opencmo.worker.job_uploads import RENDERS_BUCKET, Uploads
from opencmo.worker.media import (
    UPLOAD_UNAVAILABLE,
    UploadUnavailableError,
    make_editor_master,
    upload_object_name,
)

log = logging.getLogger(__name__)

__all__ = ["RENDERS_BUCKET", "process"]

# Supabase Free caps an object at 50 MB whatever the bucket says (COSTS.md), so the cap is an
# env var: raise it with the plan.
MAX_UPLOAD_BYTES = int(os.environ.get("OPENCMO_MAX_FULL_BYTES") or 2 * 1024**3)

# Dev: packages/engine/opencmo/worker → packages/contracts. Modal: modal_app.py copies it to /root/contracts.
_UPLOAD_LIMITS = (
    Path(__file__).resolve().parents[3] / "contracts" / "upload-limits.json",
    Path("/root/contracts/upload-limits.json"),
)


def _max_edit_seconds() -> float:
    path = next((candidate for candidate in _UPLOAD_LIMITS if candidate.exists()), None)
    if path is None:
        raise FileNotFoundError("packages/contracts/upload-limits.json not found")
    return float(json.loads(path.read_text(encoding="utf-8"))["max_edit_seconds"])


# The editor holds a project this long at most: one number with the web Upload panel, which
# refuses longer files at pick time (packages/contracts/upload-limits.json).
MAX_EDIT_SECONDS = _max_edit_seconds()

# A few seconds are enough for a playable thumbnail on the project card.
PREVIEW_SECONDS = 15.0

# Long enough for one header probe over HTTP.
SIGNED_URL_SECONDS = 1800


# Container and stream lengths differ by a frame or two; more than this means the header lied.
LENGTH_TOLERANCE_SECONDS = 2.0

LENGTH_UNKNOWN = "We could not read this video's length. Export it again as MP4 and upload that copy."
LENGTH_MISMATCH = "This video's length does not match its file header. Export it again as MP4 and upload that copy."


def _editable_length(seconds: float) -> float:
    """The length the editor may hold, or a user error: unknown, zero or over the cap."""
    if not math.isfinite(seconds) or seconds <= 0:
        raise UserMessageError(LENGTH_UNKNOWN)
    if seconds > MAX_EDIT_SECONDS:
        raise UserMessageError(
            f"Videos up to {int(MAX_EDIT_SECONDS // 60)} minutes can be edited. Trim it and upload it again."
        )
    return seconds


def _size_label(size: float) -> str:
    """A number the user recognises: "0.0 GB" is not one."""
    if size >= 1024**3:
        return f"{size / 1024**3:.1f} GB"
    return f"{size / 1024**2:.0f} MB"


def _attempt_is_published(store: Any, job: Job) -> bool:
    row = store.get_job_row(job.id) or {}
    return row.get("status") == "done" and row.get("attempt_id") == job.attempt_id


def _transcribe(master: Path, work: Path) -> str | None:
    """The master's words as the editor's transcript file, or None when there is no speech.

    A Scribe failure does not fail the job: the video is still the user's to edit by hand, and
    captions can be made later from the Inspector.
    """
    audio = work / "audio.m4a"
    try:
        extract_audio(master, audio)
        transcript = transcribe_audio(audio, Config())
    except Exception:
        log.warning("Transcript failed; publishing the video without one", exc_info=True)
        return None
    return to_ds_transcript(transcript.segments) if transcript.segments else None


def _focus(master: Path, info: Any, duration: float, aspect: str) -> dict[str, list[list[float]]] | None:
    """The editor's face tracks for the master, or None. A failure here never fails the upload: the video is
    still the user's to edit, framed in the centre."""
    frame_aspect = ASPECTS.get(aspect, 9 / 16)
    if not needs_tracking(info.width, info.height, frame_aspect):
        return None
    try:
        track, covered = face_track(master, duration, width=info.width, height=info.height)
        # A pass cut short by its budget gives keys up to where it got; the editor holds the last centre after.
        focus = editor_focus(
            track,
            source_width=info.width,
            source_height=info.height,
            frame_aspect=frame_aspect,
            duration=covered,
        )
    except Exception:
        log.warning("Face tracking failed; publishing the video framed in the centre", exc_info=True)
        return None
    return focus if focus["frame"] or focus["reframe"] else None


def _process_upload(run: JobRun, *, previous: dict[str, Any] | None) -> None:
    store, job, root = run.store, run.job, run.root
    assert root is not None
    if not job.source_url.startswith("storage://"):
        # Links were removed with the clipping tool; `create_upload_edit` refuses them too.
        raise UserMessageError("Upload the video file to edit it.")
    work = root / "work"
    work.mkdir(parents=True, exist_ok=True)

    run.set_stage("probe")
    source_object = upload_object_name(job)
    info = store.object_info(SOURCES_BUCKET, source_object)
    if info is None:
        raise UploadUnavailableError(UPLOAD_UNAVAILABLE)
    size = int(info.get("size") or 0)
    if size > MAX_UPLOAD_BYTES:
        raise UserMessageError(
            f"This video is {_size_label(size)}, which is over the {_size_label(MAX_UPLOAD_BYTES)} "
            "upload limit. Use a shorter video."
        )
    # ffprobe over HTTP reads the header only, not the whole file.
    url = store.sign_object_url(SOURCES_BUCKET, source_object, SIGNED_URL_SECONDS)
    header = probe_file(url, user_url=True).duration
    # A browser recording (MediaRecorder WebM) has no length in its header: the remuxed master
    # gives it, and the upload is billed once that is known.
    known = math.isfinite(header) and header > 0
    duration = _editable_length(header) if known else 0.0
    title = Path(source_object).name
    run.check_lease()

    # Billed on source minutes: the user pays for the length of the video they bring.
    if known:
        store.settle(job.id, duration, attempt_id=job.attempt_id)

    run.set_stage("download")
    source = work / f"source{Path(source_object).suffix or '.mp4'}"
    try:
        store.download_object(SOURCES_BUCKET, source_object, source, max_bytes=MAX_UPLOAD_BYTES)
    except PermanentError as exc:
        raise UploadUnavailableError(UPLOAD_UNAVAILABLE) from exc
    run.check_lease()

    # A retry keeps the clip id: a new id would break the editor and old links.
    clip_id = previous["id"] if previous else str(uuid.uuid4())

    run.set_stage("render")
    master = work / "master.mp4"
    make_editor_master(source, master)
    master_info = probe_file(str(master))
    # The header can lie: the remuxed master is the real length, and the header's was billed.
    length = _editable_length(master_info.duration)
    if known and length > duration + LENGTH_TOLERANCE_SECONDS:
        raise UserMessageError(LENGTH_MISMATCH)
    if not known:
        duration = length
        store.settle(job.id, duration, attempt_id=job.attempt_id)
    master_object = run.uploads.put(
        RENDERS_BUCKET, f"{job.user_id}/{clip_id}/master/{job.attempt_id}.mp4", master, content_type="video/mp4"
    )
    name = _safe_name(0, title)
    preview_file = preview_head(source, work / "preview.mp4", seconds=min(PREVIEW_SECONDS, duration))
    preview_object = run.uploads.put(
        BUCKET, storage_path(job.user_id, job.id, f"{job.attempt}/{name}.preview.mp4"), preview_file, content_type="video/mp4"
    )
    run.check_lease()

    run.set_stage("reframe")
    aspect = job.aspect if job.aspect != "auto" else "9:16"
    focus = _focus(master, master_info, master_info.duration, aspect)
    run.check_lease()

    run.set_stage("transcribe")
    transcript_object = None
    transcript_body = _transcribe(master, work)
    if transcript_body is not None:
        transcript_file = work / "master.transcript.json"
        transcript_file.write_text(transcript_body, encoding="utf-8")
        transcript_object = run.uploads.put(
            RENDERS_BUCKET,
            f"{job.user_id}/{clip_id}/master/{job.attempt_id}.transcript.json",
            transcript_file,
            content_type="application/json",
        )
    run.check_lease()

    settings = default_settings(
        0.0,
        master_info.duration,
        aspect=aspect,
        captions=job.captions and transcript_object is not None,
    ).to_dict()
    row = {
        "id": clip_id,
        "idx": 0,
        "hook": title[:120],
        "start_seconds": 0.0,
        "end_seconds": master_info.duration,
        "score": None,
        "reason": None,
        "storage_path": None,
        "preview_path": preview_object,
    }
    run.mark_publication_sent()
    published = store.complete_job_publication(
        job.id,
        job.attempt_id,
        title=title,
        duration=duration,
        clips=[row],
        revisions=[{"clip_id": clip_id, "settings": settings, "settings_hash": settings_hash(settings)}],
        manifest={
            "attempt_id": job.attempt_id,
            "masters": {
                clip_id: {
                    "bucket": RENDERS_BUCKET,
                    "object": master_object,
                    "transcript": transcript_object,
                    "bytes": master.stat().st_size,
                    "width": master_info.width,
                    "height": master_info.height,
                    "duration": master_info.duration,
                    "offset": 0.0,
                    **({"focus": focus} if focus else {}),
                }
            },
        },
    )
    if not published:
        raise StaleAttemptError(STALE_ATTEMPT)

    # The master holds the video now; the upload is kept no longer than the job's own retention.
    try:
        store.remove_objects(SOURCES_BUCKET, [source_object])
    except Exception:
        log.warning("Could not remove the upload %s after publishing", source_object, exc_info=True)


def process(store: Any, job: Job) -> None:
    """Runs a claimed job; every final write is fenced by its attempt id."""
    run = JobRun(store=store, job=job, uploads=Uploads(store))

    try:
        with (
            Heartbeat(lambda: store.heartbeat(job.id, job.attempt_id), f"job-{job.id}") as heartbeat,
            tempfile.TemporaryDirectory(prefix="opencmo-job-") as tmp,
        ):
            run.heartbeat = heartbeat
            run.root = Path(tmp)
            previous = {int(row["idx"]): row for row in store.list_clips(job.id)}
            _process_upload(run, previous=previous.get(0))
            log.info("Job %s ready to edit after %.2fs", job.id, time.monotonic() - run.started)

    except StaleAttemptError:
        log.warning("Job %s attempt %s lost its lease", job.id, job.attempt_id)
        run.uploads.cleanup(job.id)
    except InsufficientCreditsError as exc:
        store.fail(job.id, job.attempt_id, str(exc))
        run.uploads.cleanup(job.id)
    except UploadUnavailableError:
        store.fail(job.id, job.attempt_id, UPLOAD_UNAVAILABLE)
        run.uploads.cleanup(job.id)
    except TransientError:
        # After a publication timeout only the database knows whether it committed: nothing is
        # failed or removed until the canonical state is read back.
        if run.publication_sent:
            row = store.get_job_row(job.id)
            if row and row.get("status") == "done" and row.get("attempt_id") == job.attempt_id:
                return
            if not row or row.get("attempt_id") != job.attempt_id or row.get("status") != "running":
                run.uploads.cleanup(job.id)
        raise
    except Exception as exc:
        log.exception("Job %s failed", job.id)
        if run.publication_sent and _attempt_is_published(store, job):
            return
        store.fail(job.id, job.attempt_id, processing_error(exc, run.stage))
        run.uploads.cleanup(job.id)
