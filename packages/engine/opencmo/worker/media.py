"""The user's uploaded video on the worker: its storage key and the editor's master."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from urllib.parse import unquote

from opencmo.backends.supabase import Job
from opencmo.media.ffmpeg import USER_INPUT, run

log = logging.getLogger(__name__)

UPLOAD_UNAVAILABLE = "This upload is not available. Upload the video again."


class UploadUnavailableError(ValueError):
    pass


def upload_object_name(job: Job) -> str:
    """Trả storage key canonical ``user_id/filename`` của nguồn upload."""
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


def keyframe_at_or_before(source: Path, when: float, *, lookback: float = 20.0) -> float:
    """Mốc keyframe gần nhất KHÔNG SAU `when`, đọc từ packet của stream video.

    `-c copy` chỉ cắt được ở keyframe. Biết TRƯỚC mốc đó, thay vì để ffmpeg tự
    lùi, là khác biệt giữa "biết chính xác giây 0 của file ra nằm ở đâu trên
    video gốc" và "lệch tối đa một GOP mà không ai biết". Lệch đó đi thẳng vào
    `masters.offset`, rồi vào `sourceIn` và mốc phụ đề — hỏng im lặng.

    Đọc PACKET chứ không phải frame: `-skip_frame nokey` bắt ffprobe decode,
    còn packet thì chỉ phải phân tích container.
    """
    if when <= 0:
        return 0.0
    begin = max(0.0, when - lookback)
    try:
        proc = run(
            [
                "ffprobe", "-v", "error", *USER_INPUT, "-select_streams", "v:0",
                "-show_entries", "packet=pts_time,flags",
                "-read_intervals", f"{begin:.3f}%{when + 0.5:.3f}",
                "-of", "csv=p=0",
                str(source),
            ],
            timeout=60,
        )
    except Exception:
        # Không đọc được thì cắt từ đầu file: thêm vài giây vào master, nhưng
        # `offset` vẫn là một con số ĐÚNG. Đoán một mốc gần đúng thì không.
        log.warning("Không đọc được keyframe của %s — cắt master từ đầu file", source, exc_info=True)
        return 0.0

    best = 0.0
    for line in proc.stdout.splitlines():
        raw_time, _, flags = line.partition(",")
        if "K" not in flags:
            continue
        try:
            stamp = float(raw_time)
        except ValueError:
            continue
        if stamp <= when + 1e-3:
            best = max(best, stamp)
    return best


def make_editor_master(source: Path, out: Path, *, start: float = 0.0, duration: float | None = None) -> float:
    """Cắt master cho editor bằng MỘT lượt `-c copy`. Trả về giây 0 của `out`
    trên thang thời gian của `source`.

    `-c copy` là cố ý: master giữ nguyên độ phân giải nguồn mà không thêm một
    lượt encode nào — đây là I/O, không phải CPU, và không frame nào vào Python.
    `source` là file người dùng upload: đọc qua allowlist demuxer (luật engine 7).

    Mép cắt bám keyframe nên file ra bắt đầu SỚM hơn `start` tối đa một GOP.
    Phần thừa đó không bị vứt: `sourceIn` của document bù lại, và giá trị trả về
    là thứ duy nhất cho biết bù bao nhiêu.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    begin = keyframe_at_or_before(source, start)
    window = ["-ss", f"{begin:.3f}"] if begin > 0 else []
    # Tính từ mép thật, không từ `start`: thiếu phần bù này là cụt đuôi đúng bằng
    # khoảng lùi về keyframe.
    limit = ["-t", f"{(start - begin) + duration:.3f}"] if duration is not None else []
    run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            *window, *USER_INPUT, "-i", str(source), *limit,
            "-map", "0:v:0", "-map", "0:a?",
            "-c", "copy", "-movflags", "+faststart",
            str(out),
        ],
        timeout=600,
    )
    return begin
