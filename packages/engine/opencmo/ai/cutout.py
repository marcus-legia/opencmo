"""Stacked-alpha video: the picture on top, its alpha matte (luma) below, in one H.264 file.

H.264 has no alpha channel, but every browser that runs the editor decodes it, and so does the
exporter; clip-render takes the alpha back from the bottom half (`alpha: "stacked"`). Everything
runs as streaming ffmpeg: no frame is loaded into Python.
"""

from __future__ import annotations

from pathlib import Path

from opencmo.media.ffmpeg import run

#: Demuxer per provider content type: provider output is untrusted media, never sniffed.
_DEMUXERS = {"video/mp4": "mov", "video/quicktime": "mov", "video/webm": "matroska"}

_ENCODE = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]


_BY_EXTENSION = {".mp4": "mov", ".mov": "mov", ".webm": "matroska"}


def demuxer(content_type: str, url: str = "") -> str | None:
    """Demuxer for a result file. fal serves VEED results as `application/octet-stream`, so the
    file extension of the URL decides then (still an allowlist, never ffmpeg's sniffing)."""
    known = _DEMUXERS.get(content_type)
    if known:
        return known
    path = url.split("?", 1)[0].lower()
    return next((fmt for ext, fmt in _BY_EXTENSION.items() if path.endswith(ext)), None)


def stack_matte(picture: Path, picture_format: str, matte: Path, matte_format: str, out: Path) -> Path:
    """Picture + separate matte video → one stacked file (the matte is scaled to the picture)."""
    run([
        "ffmpeg", "-v", "error", "-y",
        "-f", picture_format, "-i", str(picture), "-f", matte_format, "-i", str(matte),
        "-filter_complex",
        (
            "[1:v][0:v]scale2ref=flags=bicubic[a][c];[a]format=gray,format=yuv420p[m];"
            "[c]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[p];[m]scale=trunc(iw/2)*2:trunc(ih/2)*2[q];"
            "[p][q]vstack=inputs=2[out]"
        ),
        "-map", "[out]", *_ENCODE, str(out),
    ], timeout=600)
    return out


def stack_embedded(video: Path, video_format: str, out: Path) -> Path:
    """A video with its own alpha channel (VP9 in WebM) → one stacked file."""
    decoder = ["-c:v", "libvpx-vp9"] if video_format == "matroska" else []
    run([
        "ffmpeg", "-v", "error", "-y", *decoder, "-f", video_format, "-i", str(video),
        "-filter_complex",
        (
            "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuva420p,split[c][a];"
            "[a]alphaextract,format=yuv420p[m];[c]format=yuv420p[p];[p][m]vstack=inputs=2[out]"
        ),
        "-map", "[out]", *_ENCODE, str(out),
    ], timeout=600)
    return out


def fake_cutout(source: Path, seconds: int, out: Path) -> Path:
    """Development cut-out: an ellipse of the source as the subject, the rest transparent."""
    run([
        "ffmpeg", "-v", "error", "-y", "-f", "mov", "-i", str(source), "-t", str(seconds),
        "-filter_complex",
        (
            "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p,split[c][a];"
            "[a]format=gray,geq=lum='255*lte(pow((X-W/2)/(W*0.32),2)+pow((Y-H*0.55)/(H*0.42),2),1)',format=yuv420p[m];"
            "[c][m]vstack=inputs=2[out]"
        ),
        "-map", "[out]", *_ENCODE, str(out),
    ], timeout=300)
    return out
