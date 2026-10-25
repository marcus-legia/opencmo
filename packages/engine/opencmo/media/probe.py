"""Đọc metadata của file media bằng ffprobe."""

from __future__ import annotations

import json
from dataclasses import dataclass

from .ffmpeg import USER_HTTP_INPUT, USER_INPUT, run


@dataclass
class MediaInfo:
    duration: float
    width: int
    height: int
    fps: float
    has_audio: bool
    video_codec: str = ""
    pix_fmt: str = ""

    @property
    def is_vertical(self) -> bool:
        return self.height > self.width


def _parse_fps(raw: str) -> float:
    """ffprobe trả fps dạng phân số, ví dụ '30000/1001'."""
    if "/" in raw:
        num, _, den = raw.partition("/")
        try:
            d = float(den)
            return float(num) / d if d else 0.0
        except ValueError:
            return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _quarter_turn(stream: dict) -> bool:
    """Whether the stream is shown turned by 90 or 270 degrees: the display matrix's rotation, or the old `rotate`
    tag of MP4s written before ffmpeg 5."""
    angles: list[object] = [side.get("rotation") for side in stream.get("side_data_list") or [] if isinstance(side, dict)]
    angles.append((stream.get("tags") or {}).get("rotate"))
    for angle in angles:
        try:
            if round(float(str(angle))) % 180 == 90:
                return True
        except ValueError:
            continue
    return False


def probe_file(path: str, *, local_only: bool = False, user_url: bool = False) -> MediaInfo:
    """`local_only`: a file the USER supplied, read over `file` only. `user_url`: a user file read
    through a signed URL. Both apply the demuxer allowlist, so a "video" that is really an HLS
    playlist cannot make ffprobe fetch arbitrary URLs or local files (SSRF)."""
    guard = USER_INPUT if local_only else USER_HTTP_INPUT if user_url else []
    proc = run(
        [
            "ffprobe", "-v", "error", *guard,
            "-print_format", "json",
            "-show_format", "-show_streams",
            path,
        ],
        timeout=60,
    )
    data = json.loads(proc.stdout)
    streams = data.get("streams", [])

    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise ValueError(f"No video stream found in {path}")

    width = int(video.get("width") or 0)
    height = int(video.get("height") or 0)
    # A phone video stored sideways with a rotation tag plays upright everywhere (browsers, ffmpeg's autorotate), so
    # its size is the displayed one: the coded size laid a portrait video out as landscape.
    if _quarter_turn(video):
        width, height = height, width

    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0.0)

    return MediaInfo(
        duration=duration,
        width=width,
        height=height,
        fps=_parse_fps(str(video.get("r_frame_rate", "0/1"))),
        has_audio=has_audio,
        video_codec=str(video.get("codec_name") or ""),
        pix_fmt=str(video.get("pix_fmt") or ""),
    )
