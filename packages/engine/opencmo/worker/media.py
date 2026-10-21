"""The user's uploaded video on the worker: its storage key and the editor's master."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from urllib.parse import unquote

from opencmo.backends.supabase import Job
from opencmo.media.ffmpeg import USER_INPUT, FFmpegError, run

log = logging.getLogger(__name__)

UPLOAD_UNAVAILABLE = "This upload is not available. Upload the video again."


class UploadUnavailableError(ValueError):
    pass


def upload_object_name(job: Job) -> str:
    """The upload's canonical storage key, ``user_id/filename``."""
    raw = job.source_url.removeprefix("storage://")
    decoded = unquote(raw)
    parts = decoded.split("/")
    safe_file = re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,240}", parts[-1] if parts else "")
    if (
        decoded != raw
        or "\\" in raw
        or len(parts) != 2
        or parts[0] != job.user_id
        or not safe_file
        or parts[1] in {".", ".."}
    ):
        raise UploadUnavailableError(UPLOAD_UNAVAILABLE)
    return raw


def make_editor_master(source: Path, out: Path) -> None:
    """Remux the whole upload into the editor's MP4 master, encoding only what MP4 cannot hold.

    Stream copy first: no encode, I/O not CPU, and no frame enters Python. MP4 refuses some codecs
    an allowed container carries (PCM audio in MOV/MKV, Vorbis in WebM), so a failed copy retries
    with AAC audio, then with a full encode, instead of failing an upload no retry can fix.
    `source` is the user's file: read through the demuxer allowlist.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    attempts = (
        ["-c", "copy"],
        ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"],
        ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"],
    )
    for index, codecs in enumerate(attempts):
        try:
            run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    *USER_INPUT, "-i", str(source),
                    "-map", "0:v:0", "-map", "0:a?",
                    *codecs, "-movflags", "+faststart",
                    str(out),
                ],
                timeout=600 if index < 2 else 1800,
            )
            return
        except FFmpegError:
            if index == len(attempts) - 1:
                raise
            log.warning("Master remux of %s failed with %s; trying the next way", source.name, " ".join(codecs))
