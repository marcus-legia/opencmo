from __future__ import annotations

from pathlib import Path

from opencmo.backends.supabase import Task
from opencmo.worker import probe_media


class FakeStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.completed = None
        self.removed = []

    def get_media_asset(self, _asset_id):
        return {
            "id": "asset-1", "user_id": "user-1", "job_id": "job-1",
            "storage_path": "media/user-1/job-1/bad.mp4",
        }

    def heartbeat_task(self, *_args):
        return True

    def download_object(self, _bucket, _path, dest, **_kwargs):
        dest.write_bytes(b"not a video")

    def complete_media_probe(self, *args, **kwargs):
        self.completed = (args, kwargs)
        return True

    def remove_objects(self, bucket, paths):
        self.removed.append((bucket, paths))


def test_file_rac_bi_reject_va_xoa_khoi_storage(tmp_path):
    store = FakeStore(tmp_path)
    task = Task(
        id="task-1", user_id="user-1", kind="probe_media", asset_id="asset-1",
        attempt_id="attempt-1",
    )

    probe_media.process(store, task)

    assert store.completed[1]["ok"] is False
    assert store.completed[1]["error"] == probe_media.BAD_MEDIA
    assert store.removed == [("media", ["user-1/job-1/bad.mp4"])]


def test_thieu_asset_id_thi_fail_task_ngay_khong_de_treo(tmp_path):
    """Task không có asset_id phải hỏng ngay, không nằm `running` tới hết lease.

    `complete_media_probe` tra theo asset_id nên id rỗng luôn trả false: task
    lặp lại tới hết `max_attempts` rồi mới failed, trong lúc đó UI vẫn quay.
    """
    store = FakeStore(tmp_path)
    failed: list[tuple] = []
    store.fail_task = lambda *args: failed.append(args) or True
    task = Task(
        id="task-2", user_id="user-1", kind="probe_media", asset_id=None,
        attempt_id="attempt-1",
    )

    probe_media.process(store, task)

    assert failed == [("task-2", "attempt-1", probe_media.BAD_MEDIA)]
    assert store.completed is None


def test_anh_png_qua_probe_khong_co_thoi_luong(tmp_path):
    """Frame chụp từ clip (AI transition) và ảnh tham chiếu: ảnh đọc được thì `ready`, duration rỗng."""
    import subprocess

    still = tmp_path / "still.png"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x48", "-frames:v", "1", str(still)],
        check=True,
    )
    store = FakeStore(tmp_path)
    store.get_media_asset = lambda _id: {
        "id": "asset-1", "user_id": "user-1", "job_id": "job-1",
        "storage_path": "media/user-1/job-1/frame.png",
    }
    sizes: list[int] = []

    def download(_bucket, _path, dest, **kwargs):
        sizes.append(kwargs["max_bytes"])
        dest.write_bytes(still.read_bytes())

    store.download_object = download
    task = Task(id="task-3", user_id="user-1", kind="probe_media", asset_id="asset-1", attempt_id="attempt-1")

    probe_media.process(store, task)

    assert store.completed[1] == {"duration": None, "width": 64, "height": 48, "ok": True, "error": None, "has_audio": False}
    assert sizes == [probe_media.MAX_IMAGE_BYTES]
    assert store.removed == []


def _cube(size: int) -> str:
    lines = ["TITLE \"test\"", f"LUT_3D_SIZE {size}"]
    for b in range(size):
        for g in range(size):
            for r in range(size):
                lines.append(f"{r / (size - 1)} {g / (size - 1)} {b / (size - 1)}")
    return "\n".join(lines)


def test_lut_cube_hop_le_thi_ready_kich_thuoc_luoi(tmp_path):
    store = FakeStore(tmp_path)
    store.get_media_asset = lambda _id: {
        "id": "asset-1", "user_id": "user-1", "job_id": "job-1",
        "storage_path": "media/user-1/job-1/look.cube",
    }
    store.download_object = lambda _bucket, _path, dest, **_kw: dest.write_text(_cube(5))
    task = Task(id="task-3", user_id="user-1", kind="probe_media", asset_id="asset-1", attempt_id="attempt-1")

    probe_media.process(store, task)

    assert store.completed[1] == {"duration": None, "width": 5, "height": 5, "ok": True, "error": None}
    assert store.removed == []


def test_lut_hong_hoac_1d_thi_reject_va_xoa(tmp_path):
    for body in ["LUT_3D_SIZE 5\n0 0 0", "LUT_1D_SIZE 4\n0 0 0", "\x00\xff garbage"]:
        store = FakeStore(tmp_path)
        store.get_media_asset = lambda _id: {
            "id": "asset-1", "user_id": "user-1", "job_id": "job-1",
            "storage_path": "media/user-1/job-1/look.cube",
        }
        store.download_object = lambda _bucket, _path, dest, _body=body, **_kw: dest.write_text(_body)
        task = Task(id="task-4", user_id="user-1", kind="probe_media", asset_id="asset-1", attempt_id="attempt-1")

        probe_media.process(store, task)

        assert store.completed[1]["ok"] is False
        assert store.removed == [("media", ["user-1/job-1/look.cube"])]


def test_a_json_upload_is_refused_without_being_read(tmp_path):
    """Lottie uploads were removed (2026-10-24): a .json never reaches a renderer."""
    store = FakeStore(tmp_path)
    store.get_media_asset = lambda _id: {
        "id": "asset-1", "user_id": "user-1", "job_id": "job-1",
        "storage_path": "media/user-1/job-1/wave.json",
    }

    def download(*_args, **_kw):
        raise AssertionError("a .json upload must not be downloaded")

    store.download_object = download
    probe_media.process(store, Task(id="task-5", user_id="user-1", kind="probe_media", asset_id="asset-1", attempt_id="attempt-1"))
    assert store.completed[1]["ok"] is False
    assert store.removed == [("media", ["user-1/job-1/wave.json"])]


def test_audio_the_user_adds_is_stored_so_export_can_mix_it(tmp_path):
    """Music and sound effects used to stay on the device that imported them: Export failed."""
    import subprocess

    song = tmp_path / "song.mp3"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", str(song)],
        check=True,
    )
    store = FakeStore(tmp_path)
    store.get_media_asset = lambda _id: {
        "id": "asset-1", "user_id": "user-1", "job_id": "job-1",
        "storage_path": "media/user-1/job-1/song.mp3",
    }
    store.download_object = lambda _bucket, _path, dest, **_kwargs: dest.write_bytes(song.read_bytes())
    task = Task(id="task-a", user_id="user-1", kind="probe_media", asset_id="asset-1", attempt_id="attempt-1")

    probe_media.process(store, task)

    done = store.completed[1]
    assert done["ok"] is True and done["width"] is None and done["height"] is None
    assert abs(done["duration"] - 2) < 0.2
    assert done["has_audio"] is True


def test_a_file_named_like_audio_that_is_not_is_rejected(tmp_path):
    store = FakeStore(tmp_path)
    store.get_media_asset = lambda _id: {
        "id": "asset-1", "user_id": "user-1", "job_id": "job-1",
        "storage_path": "media/user-1/job-1/fake.mp3",
    }
    task = Task(id="task-b", user_id="user-1", kind="probe_media", asset_id="asset-1", attempt_id="attempt-1")

    probe_media.process(store, task)

    assert store.completed[1]["ok"] is False
    assert store.removed == [("media", ["user-1/job-1/fake.mp3"])]


def test_a_video_reports_whether_it_has_audio_so_its_transcript_can_be_queued(tmp_path):
    import subprocess

    def video(name: str, audio: bool) -> Path:
        path = tmp_path / name
        args = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=64x48:r=10:d=1"]
        if audio:
            args += ["-f", "lavfi", "-i", "sine=f=440:d=1", "-c:a", "aac", "-shortest"]
        subprocess.run([*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True)
        return path

    for name, audio in (("talk.mp4", True), ("mute.mp4", False)):
        source = video(name, audio)
        store = FakeStore(tmp_path)
        store.get_media_asset = lambda _id, n=name: {
            "id": "asset-1", "user_id": "user-1", "job_id": "job-1", "storage_path": f"media/user-1/job-1/{n}",
        }
        store.download_object = lambda _bucket, _path, dest, src=source, **_kwargs: dest.write_bytes(src.read_bytes())
        probe_media.process(store, Task(id="t", user_id="user-1", kind="probe_media", asset_id="asset-1", attempt_id="a"))
        assert store.completed[1]["ok"] is True
        assert store.completed[1]["has_audio"] is audio, name
