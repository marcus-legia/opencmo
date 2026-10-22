"""Chạy ffmpeg/ffprobe dưới dạng subprocess.

Nguyên tắc: engine KHÔNG BAO GIỜ giữ frame video trong bộ nhớ.
Mọi biến đổi đi qua ffmpeg, thứ dùng RAM cố định bất kể video dài bao nhiêu.
Xem ARCHITECTURE.md §2, luật 1 và 2.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)


class FFmpegError(RuntimeError):
    pass


def require_binaries() -> None:
    # Tiếng Anh vì `run_pipeline` gọi hàm này BÊN TRONG job: lỗi ở đây bị worker
    # bắt và ghi vào `jobs.error`, rồi trang kết quả in thẳng ra cho người dùng.
    # Xem quy tắc ngôn ngữ ở đầu CLAUDE.md.
    missing = [b for b in ("ffmpeg", "ffprobe") if shutil.which(b) is None]
    if missing:
        raise FFmpegError(
            f"{', '.join(missing)} not found in PATH. "
            "Install with: apt install ffmpeg / brew install ffmpeg"
        )


#: Demuxer được đọc file media của NGƯỜI DÙNG (upload, ảnh/video đầu vào). ffmpeg đoán định dạng
#: theo nội dung: không giới hạn thì một file là playlist HLS / concat khiến worker đọc file khác trên
#: máy hay đi lấy URL tuỳ ý (SSRF, đọc file cục bộ). Không có hls, concat, image2 (chuỗi file theo mẫu).
USER_MEDIA_FORMATS = (
    "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,mp3,wav,aac,ogg,flac,avi,mpegts,gif,png_pipe,jpeg_pipe,webp_pipe"
)
#: Tham số đặt TRƯỚC `-i` của một file người dùng đã tải về máy.
USER_INPUT = ["-protocol_whitelist", "file", "-format_whitelist", USER_MEDIA_FORMATS]
#: The same allowlist for a user file read through a signed Storage URL (http for the local stack).
USER_HTTP_INPUT = ["-protocol_whitelist", "http,https,tls,tcp", "-format_whitelist", USER_MEDIA_FORMATS]


def run(
    args: list[str], *, timeout: int = 1800, stdin_path: Path | None = None
) -> subprocess.CompletedProcess[str]:
    """Chạy một lệnh và raise kèm stderr khi lỗi.

    ffmpeg viết mọi thứ ra stderr kể cả khi thành công, nên chỉ đọc nó lúc thất bại.

    Thông báo lỗi bằng tiếng Anh: đây là đường lỗi hay gặp nhất của một job thật,
    và nó chạy thẳng ra `jobs.error` rồi lên màn hình người dùng.
    """
    log.debug("run: %s", " ".join(args))
    if stdin_path is not None:
        # stdin là file: ffmpeg đọc `pipe:0`, không mở được file hay URL nào khác.
        with stdin_path.open("rb") as stdin:
            proc = subprocess.run(args, stdin=stdin, capture_output=True, text=True, timeout=timeout, check=False)
    else:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-15:])
        raise FFmpegError(f"Command failed (code {proc.returncode}): {' '.join(args[:6])}…\n{tail}")
    return proc


#: EXIF orientation (TIFF tag 0x0112) → the filter that turns the stored pixels upright.
_ORIENTATION_FILTERS = {
    2: "hflip", 3: "hflip,vflip", 4: "vflip",
    5: "transpose=0", 6: "transpose=1", 7: "transpose=3", 8: "transpose=2",
}


def jpeg_orientation(head: bytes) -> int:
    """The EXIF orientation of a JPEG (1-8) from its first bytes; 1 (as stored) when absent or unreadable."""
    if head[:2] != b"\xff\xd8":
        return 1
    i = 2
    while i + 4 <= len(head) and head[i] == 0xFF:
        marker = head[i + 1]
        if marker == 0xFF:
            i += 1
            continue
        if marker in (0xD9, 0xDA):
            return 1
        length = int.from_bytes(head[i + 2:i + 4], "big")
        segment = head[i + 4:i + 2 + length]
        if marker == 0xE1 and segment[:6] == b"Exif\x00\x00":
            return _tiff_orientation(segment[6:])
        i += 2 + length
    return 1


def _tiff_orientation(tiff: bytes) -> int:
    order = {b"II": "little", b"MM": "big"}.get(tiff[:2])
    if order is None or len(tiff) < 8:
        return 1
    ifd = int.from_bytes(tiff[4:8], order)
    if ifd + 2 > len(tiff):
        return 1
    for k in range(int.from_bytes(tiff[ifd:ifd + 2], order)):
        entry = tiff[ifd + 2 + 12 * k:ifd + 14 + 12 * k]
        if len(entry) < 12:
            return 1
        if int.from_bytes(entry[:2], order) == 0x0112:
            value = int.from_bytes(entry[8:10], order)
            return value if value in _ORIENTATION_FILTERS else 1
    return 1


#: Decoded, a 40 MP image is at most 320 MB (16-bit RGBA): well inside a job's 2 GB. A 30 MB PNG can
#: otherwise hold a 16k × 16k canvas, and ffmpeg (ffprobe too) decodes all of it before scaling.
MAX_IMAGE_PIXELS = 40_000_000
#: How far into the file the header walk reads: past EXIF and ICC segments to a JPEG's frame header.
IMAGE_HEAD_BYTES = 1024 * 1024


def image_size(head: bytes) -> tuple[int, int] | None:
    """Width and height of a PNG, JPEG or WebP from its header, or None when it says neither.

    Same reading as `imageSize` in packages/clip-motion/src/job-assets.ts.
    """
    if head[:8] == b"\x89PNG\r\n\x1a\n" and head[12:16] == b"IHDR" and len(head) >= 24:
        return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP" and len(head) >= 30:
        chunk = head[12:16]
        if chunk == b"VP8X":
            return 1 + int.from_bytes(head[24:27], "little"), 1 + int.from_bytes(head[27:30], "little")
        if chunk == b"VP8L":
            bits = int.from_bytes(head[21:25], "little")
            return 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
        if chunk == b"VP8 ":
            return int.from_bytes(head[26:28], "little") & 0x3FFF, int.from_bytes(head[28:30], "little") & 0x3FFF
        return None
    if head[:3] != b"\xff\xd8\xff":
        return None
    i = 2
    while i + 9 < len(head):
        if head[i] != 0xFF:
            return None
        marker = head[i + 1]
        if marker == 0xFF:
            i += 1
            continue
        # Start of frame (any coding), not DHT / JPG / DAC, which share the range.
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return int.from_bytes(head[i + 7:i + 9], "big"), int.from_bytes(head[i + 5:i + 7], "big")
        if marker in (0xD9, 0xDA):
            return None
        i += 2 + int.from_bytes(head[i + 2:i + 4], "big")
    return None


def reencode_image(raw: Path, out: Path, edge: int, *, timeout: int = 120, extra: list[str] | None = None) -> Path:
    """An untrusted image file → `out` (format from its extension), longest edge ≤ `edge`, upright.

    The bytes go through stdin with image2pipe: ffmpeg decodes exactly them and can open no other
    file or URL (an "image" that is really an HLS playlist once read files on the worker). EXIF
    orientation is applied here, not left to the ffmpeg build: browsers honour it, so a phone photo
    must come out the way the user saw it. The size is read from the header first: only PNG, JPEG
    and WebP of at most `MAX_IMAGE_PIXELS` reach the decoder.
    """
    with raw.open("rb") as fh:
        head = fh.read(IMAGE_HEAD_BYTES)
    size = image_size(head)
    if size is None or size[0] < 1 or size[1] < 1:
        raise FFmpegError("Image refused: not a PNG, JPEG or WebP with a readable size")
    if size[0] * size[1] > MAX_IMAGE_PIXELS:
        raise FFmpegError(f"Image refused: {size[0]}x{size[1]} is over {MAX_IMAGE_PIXELS // 1_000_000} MP")
    rotate = _ORIENTATION_FILTERS.get(jpeg_orientation(head))
    scale = f"scale='min({edge},iw)':'min({edge},ih)':force_original_aspect_ratio=decrease"
    run([
        "ffmpeg", "-v", "error", "-y", "-threads", "1", "-protocol_whitelist", "pipe", "-noautorotate",
        "-f", "image2pipe", "-i", "pipe:0", "-frames:v", "1",
        "-vf", f"{rotate},{scale}" if rotate else scale,
        *(extra or []),
        str(out),
    ], timeout=timeout, stdin_path=raw)
    return out


def try_run(args: list[str], *, timeout: int = 60) -> bool:
    """Chạy thử, trả về True/False thay vì raise. Dùng cho việc dò khả năng."""
    try:
        proc = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout, check=False
        )
        return proc.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def extract_audio(source: Path, target: Path, *, start: float = 0.0, duration: float | None = None) -> Path:
    """Trích audio từ một file có sẵn, sẵn sàng cho Whisper.

    Mono 16kHz vì Whisper vốn resample về đúng mức đó bên trong — hạ xuống không
    mất độ chính xác. 32k thay vì 48k: Groq chặn ở 25MB, 48k chỉ chứa được ~70
    phút, 32k chứa được ~100 phút (~14MB cho 54 phút).

    `-ss` đặt TRƯỚC `-i` (input seeking). Đặt sau thì ffmpeg decode từ đầu file
    tới điểm cắt — xem ARCHITECTURE.md §4.
    """
    # The source is the user's upload or a downloaded link: demuxer allowlist, local files only.
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *USER_INPUT]
    if start > 0:
        args += ["-ss", f"{start:.3f}"]
    args += ["-i", str(source)]
    if duration is not None:
        args += ["-t", f"{duration:.3f}"]
    args += ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "32k", str(target)]
    run(args)
    if not target.exists():
        # Tiếng Anh: lỗi này chạy thẳng vào `jobs.error` rồi lên màn hình.
        raise FFmpegError("Audio extraction failed: no output file.")
    return target
