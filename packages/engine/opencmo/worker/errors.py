"""Phân loại lỗi engine thành thông báo an toàn, có hướng xử lý cho người dùng."""

from __future__ import annotations

import errno
import subprocess

import httpx

from ..media.ffmpeg import FFmpegError

_GENERIC = "We could not get your video ready to edit. Try again. If it keeps failing, upload another copy of the video."
_NETWORK = "The connection was interrupted. Please try again."
_BUSY = "The processing service is busy right now. Please wait a few minutes and try again."
_STORAGE = "Processing storage is temporarily full. Please try again later."
_RENDER = "We could not prepare this video for the editor. Try again, or upload another copy of the video."
_SOURCE = "We could not read this video. Upload a playable MP4 file or try a different video."


class UserMessageError(RuntimeError):
    """Lỗi mà câu chữ ĐÃ được viết sẵn bằng tiếng Anh cho người dùng.

    Mặc định của `processing_error` là nuốt nội dung lỗi và thay bằng một câu
    cố định — đúng, vì stderr của ffmpeg không được lên màn hình. Nhưng có những
    lỗi mà câu duy nhất hữu ích là câu ta tự viết ("video này lớn hơn hạn mức"),
    và một câu chung chung ở đó khiến người dùng thử lại mãi một thứ không bao
    giờ chạy được.
    """


def processing_error(exc: Exception, stage: str = "") -> str:
    """Chỉ trả câu cố định; không đưa URL, stderr, transcript hay secret lên UI."""
    if isinstance(exc, UserMessageError):
        return str(exc)
    message = str(exc).lower()
    if isinstance(exc, OSError) and exc.errno == errno.ENOSPC:
        return _STORAGE
    if isinstance(exc, FFmpegError):
        if "no space left on device" in message:
            return _STORAGE
        if any(text in message for text in (
            "moov atom not found", "invalid data found when processing input",
            "could not find codec parameters", "audio extraction failed",
        )):
            return _SOURCE
        return _RENDER
    if isinstance(exc, subprocess.TimeoutExpired):
        return "Video processing took too long. Try again, or use a shorter video."
    if isinstance(exc, (httpx.TransportError, TimeoutError, ConnectionError)):
        return _NETWORK

    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    response = getattr(exc, "response", None)
    if response is not None:
        status = getattr(response, "status_code", status)
    if status in (429, 503):
        return _BUSY

    # Các chuỗi dưới đây là tiền tố cố định do engine tạo, không match từ khoá chung.
    if isinstance(exc, (ValueError, RuntimeError)) and message.startswith(
        ("no video stream found in ", "could not read the audio to transcribe.")
    ):
        return _SOURCE
    if stage in {"probe", "download"}:
        return "We could not load this video. Try again, or upload another copy of the video."
    if stage == "render":
        return _RENDER
    return _GENERIC
