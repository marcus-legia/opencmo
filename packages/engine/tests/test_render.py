"""What stays of the render step: safe file names, the export watermark, and the upload preview."""

import shutil
import subprocess

import pytest

from opencmo.media.ffmpeg import FFmpegError
from opencmo.steps.render import _safe_name, _watermark_filter, preview_head


def test_safe_name_strips_unsafe_characters():
    assert _safe_name(3, 'Anh ta nói: "quá sốc"!') == "03-anh-ta-noi-qua-soc"
    assert _safe_name(0, "!!!") == "00-clip"


def test_safe_name_keeps_vietnamese_readable():
    # Lọc thẳng ký tự sẽ biến mỗi chữ có dấu thành một gạch ngang và tên file
    # thành rác. Phải bỏ dấu trước, kể cả 'đ' (NFKD không tách được chữ này).
    assert _safe_name(1, "Bí quyết vượt qua sự trì trệ") == "01-bi-quyet-vuot-qua-su-tri-tre"
    assert _safe_name(2, "Đừng đợi hoàn hảo") == "02-dung-doi-hoan-hao"


def test_watermark_filter_sits_below_captions():
    # Phụ đề đặt ở 18% chiều cao tính từ đáy (captions.py). Watermark phải nằm
    # THẤP hơn thế, nếu không nó đè lên chữ ở mọi clip.
    f = _watermark_filter("opencmo.io", 1920)
    offset = int(f.split("y=h-")[1])
    assert offset < int(1920 * 0.18)


def test_watermark_text_is_sanitised_not_escaped():
    # Dấu nháy đơn không escape được khi nằm trong cặp nháy đơn của filtergraph,
    # và ':' thì tách tham số của drawtext. Cả hai phải biến mất khỏi chuỗi.
    f = _watermark_filter("a'b:c%d,e", 1920)
    label = f.split(":text='")[1].split("'")[0]
    assert label == "abcde"


def test_watermark_empty_after_cleaning_yields_no_filter():
    # Chuỗi toàn ký tự lạ mà vẫn dựng filter thì drawtext lỗi "no text".
    assert _watermark_filter(":::", 1920) == ""


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
def test_preview_head_reads_only_local_files_and_keeps_the_first_seconds(tmp_path):
    source = tmp_path / "talk.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=4",
         "-f", "lavfi", "-i", "sine=duration=4", "-shortest", str(source)],
        check=True,
    )
    out = preview_head(source, tmp_path / "preview.mp4", seconds=2.0)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=True,
    )
    assert 1.5 < float(probe.stdout) < 2.6
    # A URL is not a local file: the demuxer allowlist (engine rule 7) refuses it.
    with pytest.raises(FFmpegError):
        preview_head("http://127.0.0.1:9/x.mp4", tmp_path / "remote.mp4", seconds=1.0)
