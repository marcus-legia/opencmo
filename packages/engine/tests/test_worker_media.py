from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from opencmo.backends.supabase import Job
from opencmo.media.ffmpeg import run
from opencmo.media.probe import probe_file
from opencmo.worker import media


class FakeStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.uploads: list[tuple[str, str]] = []
        self.downloads: list[tuple[str, str]] = []

    def get_job_row(self, job_id: str):
        return {"id": job_id, "media_manifest": {"sections": []}}

    def download_object(self, bucket: str, path: str, dest: Path, **_kwargs):
        self.downloads.append((bucket, path))
        shutil.copyfile(self.root / bucket / path, dest)
        return dest

    def upload_object(self, bucket: str, path: str, source: Path, **_kwargs):
        target = self.root / bucket / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        self.uploads.append((bucket, path))
        return path


@pytest.fixture
def sample_video(tmp_path: Path) -> Path:
    target = tmp_path / "sample.mp4"
    run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
            "-t", "2", "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", "aac", str(target),
        ],
        timeout=60,
    )
    return target


@pytest.mark.parametrize(
    "source_url",
    [
        "storage://user-1/folder/upload.mp4",
        "storage://user-1/../upload.mp4",
        "storage://user-1/%2e%2e%2fupload.mp4",
        "storage://user-1\\upload.mp4",
    ],
)
def test_upload_source_tu_choi_path_khong_canonical(source_url: str):
    job = Job(
        id="job-1", user_id="user-1", source_url=source_url,
        clips_requested=1, attempt_id="attempt-1",
    )
    with pytest.raises(media.UploadUnavailableError):
        media.upload_object_name(job)


@pytest.fixture
def keyed_video(tmp_path: Path) -> Path:
    """20 giây, keyframe mỗi 2 giây — đủ để mép cắt KHÔNG trùng mốc yêu cầu."""
    target = tmp_path / "keyed.mp4"
    run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
            "-t", "20", "-c:v", "libx264", "-preset", "ultrafast",
            "-g", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p",
            "-c:a", "aac", str(target),
        ],
        timeout=120,
    )
    return target


def test_keyframe_at_or_before_lui_ve_mep_that(keyed_video: Path):
    assert media.keyframe_at_or_before(keyed_video, 0.0) == 0.0
    assert media.keyframe_at_or_before(keyed_video, 1.5) == 0.0
    # Đúng mốc keyframe thì trả về chính nó, không lùi thêm một GOP: lùi thừa
    # là hai giây video thừa trong mọi master.
    assert media.keyframe_at_or_before(keyed_video, 4.0) == pytest.approx(4.0, abs=0.05)
    assert media.keyframe_at_or_before(keyed_video, 7.3) == pytest.approx(6.0, abs=0.05)


def test_keyframe_at_or_before_file_hong_tra_ve_dau_file(tmp_path: Path):
    """Không đọc được thì cắt từ đầu: master to hơn, nhưng `offset` vẫn ĐÚNG."""
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    assert media.keyframe_at_or_before(broken, 9.0) == 0.0


def test_make_editor_master_giu_do_dai_va_bao_dung_mep_cat(tmp_path: Path, keyed_video: Path):
    out = tmp_path / "master.mp4"
    begin = media.make_editor_master(keyed_video, out, start=7.3, duration=6.0)

    assert begin == pytest.approx(6.0, abs=0.05)
    info = probe_file(str(out))
    # Độ dài phải phủ HẾT cửa sổ yêu cầu, tính từ mép keyframe thật. Thiếu phần
    # bù `start - begin` là cụt đuôi clip đúng bằng khoảng lùi — và không ai
    # thấy cho tới lúc xem lại bản đã xuất.
    assert info.duration == pytest.approx((7.3 - begin) + 6.0, abs=0.2)
    # `-c copy`: độ phân giải nguồn, không phải 540p của proxy.
    assert (info.width, info.height) == (640, 360)
    assert info.has_audio
