"""What the worker still renders outside the editor's exporter: the export watermark and a light
preview of an uploaded video's first seconds.

The clip pipeline (cut, reframe, burn captions) is gone (owner, 2026-10-20); the editor's
exporter (`clip-export`, task `render_document`) renders every video now.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from ..media.ffmpeg import USER_INPUT, run

PREVIEW_HEIGHT = 640
PREVIEW_BITRATE = "500k"

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _clean_watermark(text: str) -> str:
    r"""Lọc chữ watermark xuống tập ký tự an toàn cho drawtext.

    Lọc chứ không escape, vì escape ở đây không làm được: chuỗi đi qua HAI lớp
    parser (filtergraph rồi drawtext), và dấu nháy đơn thì KHÔNG escape được khi
    nằm trong cặp nháy đơn của filtergraph — phải đóng chuỗi rồi mở lại. Chữ này
    là tên thương hiệu của ta, không phải nội dung người dùng nhập, nên bỏ ký tự
    lạ đi rẻ hơn nhiều so với dựng một bộ escape đúng cho cả hai lớp.
    """
    kept = [c for c in text if c.isalnum() or c in " .@_-/|+&"]
    return "".join(kept).strip()[:48]


def _watermark_filter(text: str, height: int) -> str:
    """Chữ mờ ở đáy khung, phía DƯỚI vùng phụ đề.

    Vị trí không tuỳ tiện: phụ đề nằm ở 18% chiều cao tính từ đáy, nên watermark
    đặt ở 8% để không đè lên chữ. Cột phải là vùng nút tương tác của TikTok/Reels,
    cột trái là tên tài khoản — nên canh giữa.
    """
    label = _clean_watermark(text)
    if not label:
        return ""
    size = max(16, int(height * 0.022))
    return (
        f"drawtext=font='DejaVu Sans'"
        f":text='{label}'"
        f":fontsize={size}"
        f":fontcolor=white@0.75"
        # Viền đen mỏng: nền video sáng thì chữ trắng trơn biến mất.
        f":borderw={max(1, size // 16)}:bordercolor=black@0.5"
        f":x=(w-text_w)/2:y=h-{int(height * 0.08)}"
    )


def _safe_name(index: int, hook: str) -> str:
    """Tên file an toàn từ hook.

    Bỏ dấu trước khi lọc ký tự. Nếu lọc thẳng, mỗi chữ có dấu thành một dấu gạch
    và hook tiếng Việt biến thành rác: "Bí quyết vượt qua sự trì trệ" →
    "b-quy-t-v-t-qua-s-tr-tr". Bỏ dấu trước thì ra "bi-quyet-vuot-qua-su-tri-tre".
    """
    folded = unicodedata.normalize("NFKD", hook)
    # NFKD tách được dấu của hầu hết nguyên âm, nhưng KHÔNG tách 'đ' — nó là một
    # ký tự riêng chứ không phải 'd' cộng dấu.
    folded = folded.replace("đ", "d").replace("Đ", "D")
    ascii_only = folded.encode("ascii", "ignore").decode("ascii")

    slug = _UNSAFE.sub("-", ascii_only).strip("-").lower()[:48].strip("-") or "clip"
    return f"{index:02d}-{slug}"


def preview_head(source: Path | str, out_path: Path, *, seconds: float) -> Path:
    """A light preview of an upload's first seconds for the project card, without re-encoding the
    whole file (a 45-minute video at 640p would be an hour of CPU for a thumbnail).

    `source` is the user's file (or a signed URL to it): untrusted, so it is read through the
    demuxer allowlist (engine rule 7).
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            *USER_INPUT, "-i", str(source),
            "-t", f"{seconds:.3f}",
            "-vf", f"scale=-2:{PREVIEW_HEIGHT}",
            "-c:v", "libx264", "-preset", "veryfast",
            "-b:v", PREVIEW_BITRATE,
            "-c:a", "aac", "-b:a", "64k",
            "-movflags", "+faststart",
            str(out_path),
        ]
    )
    return out_path
