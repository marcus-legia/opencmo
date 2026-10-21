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


def _video(target: Path, *, audio: list[str], video: list[str] | None = None) -> Path:
    run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
            "-t", "4", *(video or ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]),
            *audio, str(target),
        ],
        timeout=120,
    )
    return target


def test_make_editor_master_copies_the_whole_video_at_source_size(tmp_path: Path):
    source = _video(tmp_path / "talk.mp4", audio=["-c:a", "aac"])
    out = tmp_path / "master.mp4"
    media.make_editor_master(source, out)
    info = probe_file(str(out))
    assert info.duration == pytest.approx(4.0, abs=0.2)
    assert (info.width, info.height) == (640, 360) and info.has_audio


@pytest.mark.parametrize(
    ("name", "audio", "video"),
    [
        ("camera.avi", ["-c:a", "adpcm_ima_wav"], ["-c:v", "mpeg4"]),
        ("recording.webm", ["-c:a", "libvorbis"], ["-c:v", "libvpx", "-b:v", "500k"]),
        ("capture.mkv", ["-c:a", "aac"], ["-c:v", "huffyuv"]),
    ],
)
def test_make_editor_master_encodes_what_mp4_cannot_hold(tmp_path: Path, name, audio, video):
    source = _video(tmp_path / name, audio=audio, video=video)
    out = tmp_path / "master.mp4"
    media.make_editor_master(source, out)
    info = probe_file(str(out))
    assert info.has_audio and info.duration == pytest.approx(4.0, abs=0.3)
