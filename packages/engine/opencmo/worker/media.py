"""The user's uploaded video on the worker: its storage key and the editor's master."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from urllib.parse import unquote

from opencmo.backends.supabase import Job
from opencmo.media.ffmpeg import USER_INPUT, FFmpegError, run
from opencmo.media.probe import probe_file

log = logging.getLogger(__name__)

UPLOAD_UNAVAILABLE = "This upload is not available. Upload the video again."

# Video a browser decodes as it is, by codec and pixel format; anything else (MPEG-4 Part 2,
# MJPEG, VP8, ProRes, 10-bit or 4:2:2 H.264…) copies into an MP4 the editor shows black.
BROWSER_VIDEO = {
    "h264": {"yuv420p", "yuvj420p"},
    "hevc": {"yuv420p", "yuvj420p", "yuv420p10le"},
    "vp9": {"yuv420p"},
    "av1": {"yuv420p", "yuv420p10le"},
}

# A full encode of an 8K source peaks near 4 GB on 4 threads, the whole worker; capped, near 1.2 GB.
MAX_ENCODE_SIDE = 3840
ENCODE_THREADS = 4


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

    Stream copy first when the browser can decode the video as it is (`BROWSER_VIDEO`): no encode,
    I/O not CPU, and no frame enters Python. MP4 refuses some codecs an allowed container carries
    (PCM audio in MOV/MKV, Vorbis in WebM), so a failed copy retries with AAC audio, then with a
    full encode, instead of failing an upload no retry can fix. Other video goes straight to the
    encode: copied, it would publish a master the editor cannot play.
    The full encode fits inside `MAX_ENCODE_SIDE` (never upscaled) on capped threads: decoding and
    encoding at the source's size is what breaks the per-job RAM budget, copying is not.
    `source` is the user's file: read through the demuxer allowlist.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    fit = (
        f"scale=w='min(iw,{MAX_ENCODE_SIDE})':h='min(ih,{MAX_ENCODE_SIDE})'"
        ":force_original_aspect_ratio=decrease:force_divisible_by=2"
    )
    info = probe_file(str(source), local_only=True)
    # Safari plays HEVC in MP4 only under the `hvc1` tag.
    tag = ["-tag:v", "hvc1"] if info.video_codec == "hevc" else []
    encode = [
        "-vf", fit, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-threads", str(ENCODE_THREADS), "-c:a", "aac", "-b:a", "192k",
    ]
    copies = [["-c", "copy", *tag], ["-c:v", "copy", *tag, "-c:a", "aac", "-b:a", "192k"]]
    attempts = (copies if info.pix_fmt in BROWSER_VIDEO.get(info.video_codec, ()) else []) + [encode]
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
                timeout=1800 if codecs is encode else 600,
            )
            return
        except FFmpegError:
            if index == len(attempts) - 1:
                raise
            log.warning("Master remux of %s failed with %s; trying the next way", source.name, " ".join(codecs))
