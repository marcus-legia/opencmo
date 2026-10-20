"""Task `generate` + FakeProvider (spec AI Studio §7.3–7.4).

FakeProvider chạy ffmpeg THẬT: kết quả phải là file đọc được, đúng kích thước
tỉ lệ đã chọn, đúng thời lượng — thứ timeline của editor sẽ dựa vào.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from opencmo.ai import catalog
from opencmo.ai.catalog import SpecError, get_model, price_of, validate_spec
from opencmo.ai.providers.base import Result
from opencmo.ai.providers.fake import FakeProvider
from opencmo.backends.supabase import Task
from opencmo.worker import generate_task


@pytest.fixture(autouse=True)
def _no_moderation_keys(monkeypatch):
    """Any one provider key turns output moderation on: the machine's own keys must not send these
    tests' images to a real model."""
    for name in ("GROQ_API_KEY", "OPENAI_COMPAT_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)

ROOT = Path(__file__).resolve().parents[3]


def _probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


# ------------------------------------------------------------------- catalog

def test_catalog_python_doc_dung_file_hop_dong():
    data = json.loads((ROOT / "packages" / "contracts" / "ai-models.json").read_text())
    assert set(catalog.load_models()) == {row["id"] for row in data["models"]}


@pytest.mark.parametrize(("model", "spec", "credits"), [
    ("fake-image", {"prompt": "x", "aspectRatio": "1:1"}, 1),
    ("fake-video", {"prompt": "x", "aspectRatio": "9:16", "duration": 5}, 5),
    ("fake-voice", {"prompt": "a" * 1001, "voice": "Test A"}, 2),
    ("fake-audio", {"prompt": "rain", "duration": 3}, 3),
])
def test_gia_cung_cong_thuc_voi_sql(model, spec, credits):
    assert price_of(get_model(model), spec) == credits


@pytest.mark.parametrize(("model", "spec", "message"), [
    ("fake-image", {"prompt": "x", "aspectRatio": "2:1"}, "Test image does not support that aspect ratio."),
    ("fake-image", {"prompt": "x", "aspectRatio": "1:1", "duration": 3}, "This request has settings the model does not take."),
    ("fake-video", {"prompt": "x", "aspectRatio": "1:1", "duration": 4}, "Test video does not support that duration."),
    ("fake-voice", {"prompt": "x", "voice": "Nobody"}, "Choose one of the listed voices."),
    ("fake-audio", {"prompt": "x", "duration": 30}, "Sounds are 1 to 22 seconds long."),
    ("fake-audio", {"prompt": " ", "duration": 3}, "Write a prompt first."),
])
def test_spec_sai_bi_chan_bang_cau_tieng_anh(model, spec, message):
    with pytest.raises(SpecError, match=message.replace(".", r"\.")):
        validate_spec(get_model(model), spec)


def test_hash_khop_route_next():
    """Cùng chuỗi JCS với `canonicalJson` ở web: khoá sắp theo UTF-16, không khoảng trắng."""
    expected = __import__("hashlib").sha256(
        b'{"model":"fake-image","spec":{"aspectRatio":"1:1","prompt":"a cat","seed":7}}'
    ).hexdigest()
    spec = {"seed": 7, "prompt": "a cat", "aspectRatio": "1:1"}
    assert generate_task.spec_hash("fake-image", spec) == expected


# ------------------------------------------------------------------- FakeProvider

@pytest.mark.parametrize(("ratio", "size"), [("9:16", (720, 1280)), ("1:1", (1024, 1024))])
def test_fake_image_dung_ti_le(tmp_path, ratio, size):
    model = get_model("fake-image")
    result = FakeProvider().run(model, {"prompt": "A cat's \"quote\" %{n} : , ; [x]", "aspectRatio": ratio}, tmp_path)
    assert result is not None and result.content_type == "image/png"
    video = _probe(result.path)["streams"][0]
    assert (video["width"], video["height"]) == size


def test_fake_video_dung_thoi_luong(tmp_path):
    result = FakeProvider().run(get_model("fake-video"), {"prompt": "waves", "aspectRatio": "16:9", "duration": 3}, tmp_path)
    info = _probe(result.path)
    assert abs(float(info["format"]["duration"]) - 3) < 0.2
    assert info["streams"][0]["width"] == 1280


@pytest.mark.parametrize(("model", "spec", "seconds"), [
    ("fake-voice", {"prompt": "one two three four five", "voice": "Test A"}, 2.0),
    ("fake-audio", {"prompt": "rain on a roof", "duration": 4}, 4.0),
])
def test_fake_am_thanh_dung_thoi_luong(tmp_path, model, spec, seconds):
    result = FakeProvider().run(get_model(model), spec, tmp_path)
    info = _probe(result.path)
    assert [s["codec_type"] for s in info["streams"]] == ["audio"]
    assert abs(float(info["format"]["duration"]) - seconds) < 0.2


# ------------------------------------------------------------------- task

class FakeStore:
    def __init__(self, generation: dict, *, complete: bool = True) -> None:
        self.generation = generation
        self.complete_result = complete
        self.uploaded: list[tuple] = []
        self.completed: dict | None = None
        self.failed: list[str] = []
        self.removed: list[tuple] = []
        self.codes: dict = {}

    def get_generation(self, _id):
        return self.generation

    def heartbeat_task(self, *_args):
        return True

    def upload_object(self, bucket, path, local, *, content_type=None):
        assert local.exists()
        self.uploaded.append((bucket, path, content_type))
        return path

    def complete_generation(self, task_id, attempt_id, **kwargs):
        self.completed = kwargs
        return self.complete_result

    def fail_task(self, _task_id, _attempt, error):
        self.failed.append(error)
        return True

    def remove_objects(self, bucket, paths):
        self.removed.append((bucket, paths))

    def get_scene_code(self, user_id, code_hash):
        return self.codes.get((user_id, code_hash))


GEN_ID = "11111111-2222-4333-8444-555555555555"


def _generation(**overrides):
    spec = {"prompt": "a red fox in snow", "aspectRatio": "1:1"}
    row = {
        "id": GEN_ID, "task_id": "task-1", "user_id": "user-1", "job_id": "job-1",
        "model": "fake-image", "spec": spec,
        "spec_hash": generate_task.spec_hash("fake-image", spec),
    }
    row.update(overrides)
    return row


def _task():
    return Task(
        id="task-1", user_id="user-1", kind="generate", job_id="job-1",
        payload={"generation_id": GEN_ID}, attempt_id="attempt-1",
    )


def test_sinh_anh_tai_len_media_va_chot(monkeypatch):
    monkeypatch.setenv("OPENCMO_AI_FAKE", "1")
    store = FakeStore(_generation())
    generate_task.process(store, _task())

    assert store.failed == []
    assert store.uploaded == [("media", "user-1/job-1/gen-attempt-1.png", "image/png")]
    assert store.completed["object_name"] == "user-1/job-1/gen-attempt-1.png"
    assert store.completed["name"] == "a red fox in snow.png"
    assert (store.completed["width"], store.completed["height"]) == (1024, 1024)
    assert store.completed["duration"] is None, "ảnh không có thời lượng"
    assert store.completed["credits"] == 1


def test_retried_attempt_uploads_its_own_object(monkeypatch):
    """A retry (worker killed after the upload, Modal retry) must not collide with the previous
    attempt's object: uploads never overwrite, so the paid result used to fail on the size check."""
    monkeypatch.setenv("OPENCMO_AI_FAKE", "1")
    store = FakeStore(_generation())
    generate_task.process(store, _task())
    retry = Task(id="task-1", user_id="user-1", kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-2")
    generate_task.process(store, retry)
    names = [name for _bucket, name, _type in store.uploaded]
    assert len(names) == 2 and len(set(names)) == 2


def test_ten_file_cat_o_ranh_gioi_tu_khong_them_ky_tu_la():
    name = generate_task._file_name("Welcome back to the channel. Today we test the voice path end to end.", "m4a")
    assert name == "Welcome back to the channel. Today we test the.m4a"
    assert name.isascii()


def test_bi_huy_giua_chung_thi_xoa_file_vua_tai(monkeypatch):
    monkeypatch.setenv("OPENCMO_AI_FAKE", "1")
    store = FakeStore(_generation(), complete=False)
    generate_task.process(store, _task())
    assert store.removed == [("media", ["user-1/job-1/gen-attempt-1.png"])]


def test_model_gia_bi_chan_khi_khong_bat(monkeypatch):
    monkeypatch.delenv("OPENCMO_AI_FAKE", raising=False)
    store = FakeStore(_generation())
    generate_task.process(store, _task())
    assert store.failed == ["This model is not available."]
    assert store.uploaded == []


def test_hash_khong_khop_spec_thi_khong_sinh(monkeypatch):
    monkeypatch.setenv("OPENCMO_AI_FAKE", "1")
    store = FakeStore(_generation(spec_hash="0" * 64))
    generate_task.process(store, _task())
    assert store.failed == ["Invalid generation request."]
    assert store.uploaded == []


def test_generation_cua_task_khac_thi_hong_ngay(monkeypatch):
    monkeypatch.setenv("OPENCMO_AI_FAKE", "1")
    store = FakeStore(_generation(task_id="task-other"))
    generate_task.process(store, _task())
    assert store.failed == [generate_task.FAILED]
    assert store.uploaded == []


def test_canh_code_tai_code_cua_dung_nguoi_roi_moi_render(monkeypatch):
    # Cảnh code: spec chỉ mang code_ref; worker tải code của CHÍNH chủ task.
    spec = {"prompt": "Staircase", "aspectRatio": "1:1", "duration": 5, "scene": {"template": "code", "code_ref": "c" * 64}}
    store = FakeStore(_generation(model="studio-3d", spec=spec, spec_hash=generate_task.spec_hash("studio-3d", spec)))
    seen = {}

    class Adapter:
        def run(self, model, spec, workdir, alive):
            seen["code"] = spec.get("code")
            raise generate_task.ProviderError("stop here")

    monkeypatch.setattr(generate_task, "adapter_for", lambda model: Adapter())
    store.codes = {}
    generate_task.process(store, _task())
    assert store.failed == ["This 3D scene code was not found. Preview it again."]
    assert seen == {}, "không có code thì không render"

    store = FakeStore(_generation(model="studio-3d", spec=spec, spec_hash=generate_task.spec_hash("studio-3d", spec)))
    store.codes = {("user-1", "c" * 64): "return (t) => {};"}
    generate_task.process(store, _task())
    assert seen["code"] == "return (t) => {};"


def test_anh_bi_kiem_duyet_chan_thi_hong_va_khong_len_bucket(monkeypatch):
    # Đầu ra bị gắn cờ: không file nào lên `media`, task hỏng bằng câu tiếng Anh
    # (trigger trên `tasks` hoàn credit), không retry — gọi lại là trả tiền lại.
    monkeypatch.setenv("OPENCMO_AI_FAKE", "1")
    spec = {"prompt": "a red fox [[flag-output]]", "aspectRatio": "1:1"}
    store = FakeStore(_generation(spec=spec, spec_hash=generate_task.spec_hash("fake-image", spec)))
    generate_task.process(store, _task())
    assert store.failed == ["This result was blocked by our content policy. Your credits were refunded."]
    assert store.uploaded == []
    assert store.completed is None


def test_kiem_duyet_bo_qua_canh_3d_cua_minh():
    from opencmo.ai.catalog import get_model
    from opencmo.ai.moderation import needs_check

    assert needs_check(get_model("gemini-image")) and needs_check(get_model("gemini-video"))
    assert not needs_check(get_model("studio-3d")), "3D tự render: lời đã kiểm ở web"
    assert not needs_check(get_model("gemini-voice"))


class _RecordingAdapter:
    """Adapter giả cho model fal: ghi lại spec nó nhận, trả một ảnh PNG."""

    def __init__(self) -> None:
        self.spec: dict | None = None

    def run(self, model, spec, workdir, *, alive=lambda: True):
        import subprocess

        from opencmo.ai.providers.base import Result

        self.spec = spec
        # Đo ngay trong lượt chạy: thư mục tạm của worker bị xoá khi task xong.
        self.sizes = {}
        for key in ("startImage", "endImage"):
            if key in spec:
                probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", spec[key]], capture_output=True, text=True, check=True)
                self.sizes[key] = tuple(int(v) for v in probe.stdout.strip().split(","))
        out = workdir / "out.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=64x64:d=1", "-pix_fmt", "yuv420p", str(out)], check=True)
        return Result(out, "video/mp4", "mp4")

    def cost(self, model, spec, result):
        return 1


def _ref_store(spec, owner="user-1"):
    import subprocess

    store = FakeStore(_generation(model="fal-seedance", spec=spec, spec_hash=generate_task.spec_hash("fal-seedance", spec)))

    def download_object(bucket, path, dest, *, max_bytes=None):
        assert bucket == "media"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=3000x2000", "-frames:v", "1", "-f", "image2", str(dest)], check=True)
        return dest

    store.download_object = download_object
    return store


def test_anh_dau_vao_cua_nguoi_khac_bi_chan_truoc_khi_goi_provider(monkeypatch):
    adapter = _RecordingAdapter()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    spec = {"prompt": "a fox", "aspectRatio": "9:16", "duration": 5, "startImage": "user-2/job/a.png"}
    store = _ref_store(spec)
    generate_task.process(store, _task())
    assert store.failed == ["That image was not found in your library."]
    assert adapter.spec is None, "không gọi provider"


def test_anh_dau_vao_tai_ve_thu_nho_roi_chuyen_cho_provider(monkeypatch):
    adapter = _RecordingAdapter()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    # Spec hợp lệ theo catalog cần tên object dạng `<uuid>/…`; chủ task trong test là "user-1",
    # nên đổi user_id của task cho khớp tiền tố.
    uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    spec = {"prompt": "a fox", "aspectRatio": "9:16", "duration": 5, "startImage": f"{uid}/job-1/a.png", "endImage": f"{uid}/job-1/b.png"}
    store = _ref_store(spec)
    store.generation["user_id"] = uid
    task = Task(id="task-1", user_id=uid, kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-1")
    generate_task.process(store, task)
    assert store.failed == []
    start = adapter.spec["startImage"]
    assert start.endswith(".jpg") and not start.startswith(uid), "provider nhận file trên đĩa, không phải tên object"
    assert max(adapter.sizes["startImage"]) <= 1100 and max(adapter.sizes["endImage"]) <= 1100, "ảnh 3000×2000 thu nhỏ còn cạnh dài ≤ 1100"


def test_fake_video_dung_frame_dau_cuoi_va_anh_tham_chieu(tmp_path):
    """Provider giả dùng ảnh đầu vào thật: frame đầu ra màu ảnh đầu, frame cuối ra màu ảnh cuối."""
    import subprocess

    def still(name: str, color: str) -> Path:
        path = tmp_path / name
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s=200x300", "-frames:v", "1", str(path)], check=True)
        return path

    def pixel(video: Path, at: str) -> tuple[int, int, int]:
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-sseof" if at == "end" else "-ss", "-0.1" if at == "end" else "0", "-i", str(video),
             "-frames:v", "1", "-vf", "crop=4:4:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            check=True, capture_output=True,
        ).stdout
        return raw[0], raw[1], raw[2]

    red, blue = still("red.png", "red"), still("blue.png", "blue")
    out = tmp_path / "v"
    out.mkdir()
    result = FakeProvider().run(
        get_model("fake-video"),
        {"prompt": "x", "aspectRatio": "9:16", "duration": 3, "startImage": str(red), "endImage": str(blue)},
        out,
    )
    first, last = pixel(result.path, "start"), pixel(result.path, "end")
    assert first[0] > 180 and first[2] < 80, first
    assert last[2] > 180 and last[0] < 80, last

    image_dir = tmp_path / "i"
    image_dir.mkdir()
    image = FakeProvider().run(get_model("fake-image"), {"prompt": "x", "aspectRatio": "1:1", "references": [str(blue)]}, image_dir)
    corner = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(image.path), "-vf", "crop=4:4:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        check=True, capture_output=True,
    ).stdout
    assert corner[2] > 180 and corner[0] < 80


def _edit_store(tmp_path, spec, uid, model="fal-kling-edit"):
    """Store giả cho model sửa video: `sign_object_url` trả một video 640×360, 12 s trên đĩa."""
    import subprocess

    source = tmp_path / "upload.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=12", "-f", "lavfi", "-i", "sine=d=12",
         "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)],
        check=True,
    )
    store = FakeStore(_generation(model=model, spec=spec, spec_hash=generate_task.spec_hash(model, spec), user_id=uid))
    store.signed = []

    def sign_object_url(bucket, path, expires_in=3600):
        store.signed.append((bucket, path))
        return str(source)

    store.sign_object_url = sign_object_url
    return store


def test_sua_video_cat_dung_doan_dua_canh_ngan_ve_720(monkeypatch, tmp_path):
    """G2: worker cắt [sourceStart, +duration] từ URL đã ký, cạnh ngắn 720 px, giữ tiếng."""
    import subprocess

    seen: dict = {}

    class Recording(_RecordingAdapter):
        def run(self, model, spec, workdir, *, alive=lambda: True):
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", spec["sourceVideo"]],
                capture_output=True, text=True, check=True,
            )
            seen["probe"] = json.loads(probe.stdout)
            return super().run(model, spec, workdir, alive=alive)

    adapter = Recording()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    spec = {"prompt": "make it night", "aspectRatio": "16:9", "duration": 4, "sourceVideo": f"{uid}/job-1/clip.mp4", "sourceStart": 5}
    store = _edit_store(tmp_path, spec, uid)
    generate_task.process(store, Task(id="task-1", user_id=uid, kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-1"))
    assert store.failed == [], store.failed
    assert store.signed == [("media", f"{uid}/job-1/clip.mp4")]
    video = next(s for s in seen["probe"]["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1280, 720), "cạnh ngắn 360 → 720"
    assert any(s["codec_type"] == "audio" for s in seen["probe"]["streams"]), "giữ tiếng gốc"
    assert abs(float(seen["probe"]["format"]["duration"]) - 4) < 0.2


def test_sua_video_cua_nguoi_khac_bi_chan_truoc_khi_ky_url(monkeypatch, tmp_path):
    adapter = _RecordingAdapter()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    other = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    spec = {"prompt": "x", "aspectRatio": "16:9", "duration": 4, "sourceVideo": f"{other}/job-1/clip.mp4", "sourceStart": 0}
    store = _edit_store(tmp_path, spec, uid)
    generate_task.process(store, Task(id="task-1", user_id=uid, kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-1"))
    assert store.failed == ["Choose a video from your library to edit."]
    assert store.signed == [] and adapter.spec is None


def test_payload_fal_sua_video_chi_gui_prompt_video_va_tham_chieu(tmp_path):
    from opencmo.ai.providers.fal import build_payload, endpoint_for

    clip = tmp_path / "source.mp4"
    clip.write_bytes(b"mp4")
    ref = tmp_path / "ref.png"
    ref.write_bytes(b"png")
    model = get_model("fal-kling-edit")
    spec = {"prompt": "the mug from image 1", "aspectRatio": "9:16", "duration": 5, "sourceVideo": str(clip), "sourceStart": 0, "references": [str(ref)]}
    payload = build_payload(model, spec)
    assert set(payload) == {"prompt", "video_url", "keep_audio", "image_urls"}
    assert payload["video_url"].startswith("data:video/mp4;base64,") and payload["keep_audio"] is True
    assert endpoint_for(model, spec) == "fal-ai/kling-video/o1/video-to-video/edit"


def test_fake_sua_video_giu_khung_nguon(tmp_path):
    import subprocess

    source = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=30:d=4", "-pix_fmt", "yuv420p", str(source)], check=True)
    out = tmp_path / "o"
    out.mkdir()
    result = FakeProvider().run(get_model("fake-edit"), {"prompt": "night", "aspectRatio": "9:16", "duration": 3, "sourceVideo": str(source), "sourceStart": 0}, out)
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", str(result.path)], capture_output=True, text=True, check=True).stdout)
    assert (probe["streams"][0]["width"], probe["streams"][0]["height"]) == (720, 1280)
    assert abs(float(probe["format"]["duration"]) - 3) < 0.2


def test_sua_video_playlist_hls_gia_mp4_bi_tu_choi(monkeypatch, tmp_path):
    """SSRF: "video" thật ra là playlist HLS trỏ ra ngoài — ffmpeg không được đi lấy URL."""
    adapter = _RecordingAdapter()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    spec = {"prompt": "x", "aspectRatio": "16:9", "duration": 4, "sourceVideo": f"{uid}/job-1/clip.mp4", "sourceStart": 0}
    store = _edit_store(tmp_path, spec, uid)
    secret = tmp_path / "secret.txt"
    secret.write_text("worker secret")
    playlist = tmp_path / "evil.mp4"
    playlist.write_text(f"#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nfile://{secret}\n#EXT-X-ENDLIST\n")
    store.sign_object_url = lambda bucket, path, expires_in=3600: str(playlist)
    generate_task.process(store, Task(id="task-1", user_id=uid, kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-1"))
    assert store.failed == ["Choose a video from your library to edit."]
    assert adapter.spec is None, "không gọi provider"


def test_anh_dau_vao_la_playlist_hls_bi_tu_choi_khong_doc_file_khac(monkeypatch, tmp_path):
    """Đọc file cục bộ: "ảnh" là playlist HLS trỏ tới một ảnh khác trên worker — không được giải mã."""
    import subprocess

    other = tmp_path / "other-user.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=green:s=64x64", "-frames:v", "1", str(other)], check=True)
    adapter = _RecordingAdapter()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    spec = {"prompt": "a fox", "aspectRatio": "9:16", "duration": 5, "startImage": f"{uid}/job-1/a.png"}
    store = _ref_store(spec)
    store.generation["user_id"] = uid

    def download_object(bucket, path, dest, *, max_bytes=None):
        Path(dest).write_text(f"#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nfile://{other}\n#EXT-X-ENDLIST\n")
        return dest

    store.download_object = download_object
    generate_task.process(store, Task(id="task-1", user_id=uid, kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-1"))
    assert store.failed, "lượt sinh hỏng"
    assert adapter.spec is None, "không gọi provider"


def test_upscale_fal_chi_gui_video_va_do_phan_giai(tmp_path):
    from opencmo.ai.providers.fal import build_payload, endpoint_for

    clip = tmp_path / "source.mp4"
    clip.write_bytes(b"mp4")
    model = get_model("fal-seedvr-upscale")
    spec = {"prompt": "Upscale", "aspectRatio": "9:16", "duration": 4, "resolution": "2160p", "sourceVideo": str(clip), "sourceStart": 0}
    payload = build_payload(model, spec)
    assert set(payload) == {"video_url", "upscale_mode", "target_resolution"}
    assert payload["target_resolution"] == "2160p" and payload["upscale_mode"] == "target"
    assert endpoint_for(model, spec) == "fal-ai/seedvr/upscale/video"


def test_fake_upscale_phong_canh_ngan_len_1080(tmp_path):
    import subprocess

    source = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=3", "-pix_fmt", "yuv420p", str(source)], check=True)
    out = tmp_path / "o"
    out.mkdir()
    result = FakeProvider().run(
        get_model("fake-upscale"),
        {"prompt": "Upscale", "aspectRatio": "9:16", "duration": 2, "resolution": "1080p", "sourceVideo": str(source), "sourceStart": 0},
        out,
    )
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", str(result.path)], capture_output=True, text=True, check=True).stdout)
    assert (probe["streams"][0]["width"], probe["streams"][0]["height"]) == (1080, 1920)
    assert abs(float(probe["format"]["duration"]) - 2) < 0.2


def test_catalog_db_de_gia_gioi_han_va_tat_model(monkeypatch):
    """G5: hàng ai_models trong DB là nguồn khi chạy — tắt ở DB thì worker không sinh."""
    from opencmo.ai.catalog import with_row

    base = get_model("fake-video")
    assert with_row(base, None) is base
    wider = with_row(base, {"price": {"unit": "second", "credits": 9}, "limits": {**base.limits, "durations": [3, 5, 7]}, "enabled": True})
    assert wider.price["credits"] == 9 and 7 in wider.limits["durations"] and wider.provider_model == base.provider_model
    with pytest.raises(generate_task.SpecError, match="not available"):
        with_row(base, {"price": base.price, "limits": base.limits, "enabled": False})

    monkeypatch.setenv("OPENCMO_AI_FAKE", "1")
    store = FakeStore(_generation())
    store.get_ai_model = lambda _id: {"price": {"unit": "generation", "credits": 1}, "limits": {}, "enabled": False}
    generate_task.process(store, _task())
    assert store.failed == ["This model is not available."] and store.uploaded == []


# ------------------------------------------------------------------ background removal


def _frame_rgba(path, at=0.5):
    """First decoded frame of `path` as raw RGB24 bytes plus its size."""
    import subprocess

    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout)
    width, height = probe["streams"][0]["width"], probe["streams"][0]["height"]
    # Seeking into a 1 s test clip sometimes decodes no frame at all; at=0 reads the first one.
    seek = ["-ss", str(at)] if at else []
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", *seek, "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    assert len(raw) == width * height * 3, f"no frame decoded from {path.name}"
    return raw, width, height


def _luma(raw, width, x, y):
    i = (y * width + x) * 3
    return (raw[i] * 77 + raw[i + 1] * 150 + raw[i + 2] * 29) >> 8


def test_cutout_reads_the_clips_own_video_from_renders_at_1080(monkeypatch, tmp_path):
    """Background removal may read the clip's own master (renders bucket) and keeps a 1080 short edge."""
    import subprocess

    seen: dict = {}

    class Recording(_RecordingAdapter):
        def run(self, model, spec, workdir, *, alive=lambda: True):
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", spec["sourceVideo"]],
                capture_output=True, text=True, check=True,
            )
            seen["probe"] = json.loads(probe.stdout)
            return super().run(model, spec, workdir, alive=alive)

    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: Recording())
    uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    ref = f"{uid}/clip-1/master/attempt-1.mp4"
    spec = {"prompt": "Remove background", "aspectRatio": "16:9", "duration": 3, "sourceVideo": f"renders:{ref}", "sourceStart": 2}
    store = _edit_store(tmp_path, spec, uid, model="fake-cutout")
    generate_task.process(store, Task(id="task-1", user_id=uid, kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-1"))
    assert store.failed == [], store.failed
    assert store.signed == [("renders", ref)]
    video = next(s for s in seen["probe"]["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1920, 1080)


def test_cutout_of_someone_elses_master_is_refused_before_signing(monkeypatch, tmp_path):
    adapter = _RecordingAdapter()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    other = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    spec = {"prompt": "Remove background", "aspectRatio": "16:9", "duration": 3, "sourceVideo": f"renders:{other}/clip/master/a.mp4", "sourceStart": 0}
    store = _edit_store(tmp_path, spec, uid, model="fake-cutout")
    generate_task.process(store, Task(id="task-1", user_id=uid, kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-1"))
    assert store.failed == ["Choose a video from your library to edit."]
    assert store.signed == [] and adapter.spec is None


def test_edit_models_read_the_clips_own_video_at_the_edit_size(monkeypatch, tmp_path):
    """`edit_video`: Kling edit (`clipVideo`) may read the clip's own master, at a 720 short edge."""
    import subprocess

    seen: dict = {}

    class Recording(_RecordingAdapter):
        def run(self, model, spec, workdir, *, alive=lambda: True):
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", spec["sourceVideo"]],
                capture_output=True, text=True, check=True,
            )
            seen["probe"] = json.loads(probe.stdout)
            return super().run(model, spec, workdir, alive=alive)

    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: Recording())
    uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    ref = f"{uid}/clip-1/master/attempt-1.mp4"
    spec = {"prompt": "make it night", "aspectRatio": "16:9", "duration": 4, "sourceVideo": f"renders:{ref}", "sourceStart": 0}
    store = _edit_store(tmp_path, spec, uid)
    generate_task.process(store, Task(id="task-1", user_id=uid, kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-1"))
    assert store.failed == [], store.failed
    assert store.signed == [("renders", ref)]
    video = next(s for s in seen["probe"]["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1280, 720)


def test_upscale_cannot_read_the_clips_own_video(monkeypatch, tmp_path):
    adapter = _RecordingAdapter()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    spec = {"prompt": "Upscale", "aspectRatio": "16:9", "duration": 4, "resolution": "1080p", "sourceVideo": f"renders:{uid}/clip/master/a.mp4", "sourceStart": 0}
    store = _edit_store(tmp_path, spec, uid, model="fal-seedvr-upscale")
    generate_task.process(store, Task(id="task-1", user_id=uid, kind="generate", job_id="job-1", payload={"generation_id": GEN_ID}, attempt_id="attempt-1"))
    assert store.failed == ["Choose a video from your library to edit."]
    assert adapter.spec is None


def test_fal_cutout_asks_for_h264_picture_and_matte(tmp_path):
    from opencmo.ai.providers.fal import build_payload, endpoint_for

    clip = tmp_path / "source.mp4"
    clip.write_bytes(b"mp4")
    model = get_model("fal-veed-cutout")
    spec = {"prompt": "Remove background", "aspectRatio": "9:16", "duration": 4, "sourceVideo": str(clip), "sourceStart": 0}
    # Video endpoints reject data URLs; the provider uploads the clip and passes its URL.
    assert build_payload(model, spec, lambda path: f"https://cdn/{path.name}") == {"video_url": "https://cdn/source.mp4", "output_codec": "h264"}
    assert endpoint_for(model, spec) == "veed/video-background-removal"


def test_fal_cutout_finds_picture_and_matte_in_either_response_shape():
    from opencmo.ai.providers.fal import cutout_urls

    assert cutout_urls({"video": {"url": "rgb"}, "alpha_video": {"url": "a"}}) == ("rgb", "a")
    assert cutout_urls({"rgb_video": {"url": "rgb"}, "mask_video": {"url": "a"}}) == ("rgb", "a")
    assert cutout_urls({"video": {"url": "vp9"}}) == ("vp9", None)


def test_stacked_cutout_puts_the_picture_on_top_and_the_matte_below(tmp_path):
    """Picture + matte (fal h264) and picture with alpha (fal vp9) both become one stacked H.264 file."""
    import subprocess

    from opencmo.ai.cutout import stack_embedded, stack_matte

    picture = tmp_path / "rgb.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=320x240:d=1", "-pix_fmt", "yuv420p", str(picture)], check=True)
    matte = tmp_path / "alpha.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=160x120:d=1", "-vf", "drawbox=x=0:y=0:w=80:h=120:color=white:t=fill", "-pix_fmt", "yuv420p", str(matte)],
        check=True,
    )
    out = stack_matte(picture, "mov", matte, "mov", tmp_path / "stacked.mp4")
    raw, width, height = _frame_rgba(out, at=0)
    assert (width, height) == (320, 480)
    assert raw[(10 * width + 10) * 3] > 200, "top half is the red picture"
    assert _luma(raw, width, 40, 360) > 200 and _luma(raw, width, 280, 360) < 30, "bottom half is the matte, scaled to the picture"

    webm = tmp_path / "alpha.webm"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=320x240:d=1,format=rgba,geq=r=255:g=0:b=0:a='if(lt(X,160),255,0)'",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", str(webm)],
        check=True,
    )
    out = stack_embedded(webm, "matroska", tmp_path / "stacked2.mp4")
    raw, width, height = _frame_rgba(out, at=0)
    assert (width, height) == (320, 480)
    assert _luma(raw, width, 40, 360) > 200 and _luma(raw, width, 280, 360) < 30


def test_fake_cutout_keeps_an_ellipse_of_the_source(tmp_path):
    import subprocess

    source = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=3", "-pix_fmt", "yuv420p", str(source)], check=True)
    out = tmp_path / "o"
    out.mkdir()
    result = FakeProvider().run(
        get_model("fake-cutout"),
        {"prompt": "Remove background", "aspectRatio": "9:16", "duration": 2, "sourceVideo": str(source), "sourceStart": 0},
        out,
    )
    raw, width, height = _frame_rgba(result.path)
    assert (width, height) == (360, 1280), "picture on top of the matte"
    assert _luma(raw, width, 180, 640 + 352) > 200, "subject in the middle is opaque"
    assert _luma(raw, width, 5, 640 + 5) < 30, "corner is transparent"


LIVE = Path(__file__).parent / "fixtures" / "live"


def test_fal_cutout_parses_the_real_veed_response():
    """`fixtures/live/fal-veed-cutout.json` is a real response (URLs replaced), 2026-10-11."""
    from opencmo.ai.cutout import demuxer
    from opencmo.ai.providers.fal import cutout_urls

    body = json.loads((LIVE / "fal-veed-cutout.json").read_text())
    picture, matte = cutout_urls(body)
    assert picture.endswith("_color.mp4") and matte and matte.endswith("_alpha.mp4")
    # fal serves both as application/octet-stream: the extension picks the demuxer.
    assert demuxer("application/octet-stream", picture) == "mov"
    assert demuxer("application/octet-stream", "https://x/out.bin") is None


# ------------------------------------------------------------------- chained shots (/video)

PARENT_ID = "99999999-2222-4333-8444-555555555555"


def _chain_store(tmp_path, *, parent_overrides=None, parent_file=None):
    """A continuing shot (`after`) whose parent finished as a red→blue clip in the media bucket."""
    import subprocess

    parent_spec = {"prompt": "a desk", "aspectRatio": "9:16", "duration": 5, "seed": 1}
    parent_hash = generate_task.spec_hash("fal-seedance", parent_spec)
    spec = {"prompt": "the screen lights up", "aspectRatio": "9:16", "duration": 5, "seed": 2, "after": parent_hash}
    child = _generation(model="fal-seedance", spec=spec, spec_hash=generate_task.spec_hash("fal-seedance", spec), after_id=PARENT_ID)
    parent = {
        "id": PARENT_ID, "user_id": "user-1", "job_id": "job-1", "status": "done", "model": "fal-seedance",
        "spec": parent_spec, "spec_hash": parent_hash, "media_asset_id": "asset-1", **(parent_overrides or {}),
    }
    clip = tmp_path / "parent.mp4"
    if parent_file is None:
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=360x640:r=30:d=1",
            "-f", "lavfi", "-i", "color=blue:s=360x640:r=30:d=1", "-filter_complex", "[0][1]concat=n=2:v=1",
            "-pix_fmt", "yuv420p", str(clip),
        ], check=True)
    else:
        clip.write_bytes(parent_file)

    store = FakeStore(child)
    store.get_generation = lambda gen_id: {GEN_ID: child, PARENT_ID: parent}.get(gen_id)
    store.get_media_asset = lambda _id: {"id": "asset-1", "storage_path": "media/user-1/job-1/gen-parent.mp4"}
    store.downloads = []

    def download_object(bucket, path, dest, *, max_bytes=None):
        store.downloads.append((bucket, path, max_bytes))
        dest.write_bytes(clip.read_bytes())
        return dest

    store.download_object = download_object
    return store


def test_a_continuing_shot_starts_from_the_parents_last_frame(monkeypatch, tmp_path):
    import subprocess

    seen: dict = {}

    class Recording(_RecordingAdapter):
        def run(self, model, spec, workdir, *, alive=lambda: True):
            # The average colour of the start frame, as one RGB pixel.
            pixel = subprocess.run(
                ["ffmpeg", "-v", "error", "-i", spec["startImage"], "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                capture_output=True, check=True,
            ).stdout
            seen["color"] = tuple(pixel[:3])
            return super().run(model, spec, workdir, alive=alive)

    adapter = Recording()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    store = _chain_store(tmp_path)
    generate_task.process(store, _task())
    assert store.failed == [], store.failed
    assert store.downloads == [("media", "user-1/job-1/gen-parent.mp4", generate_task.PARENT_MAX_BYTES)]
    red, _green, blue = seen["color"]
    assert blue > 200 and red < 60, f"the last frame of a red→blue clip is blue, got {seen['color']}"
    assert "after" not in adapter.spec, "providers never see the chain"


@pytest.mark.parametrize("overrides", [
    {"user_id": "user-2"},
    {"job_id": "job-2"},
    {"status": "running"},
    {"spec_hash": "f" * 64},
])
def test_a_parent_that_is_not_ready_or_not_ours_is_refused(monkeypatch, tmp_path, overrides):
    adapter = _RecordingAdapter()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    store = _chain_store(tmp_path, parent_overrides=overrides)
    generate_task.process(store, _task())
    assert store.failed == [generate_task.SHOT_BEFORE]
    assert adapter.spec is None


def test_a_disguised_playlist_as_parent_is_refused(monkeypatch, tmp_path):
    adapter = _RecordingAdapter()
    monkeypatch.setattr(generate_task, "adapter_for", lambda _model: adapter)
    playlist = b"#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n"
    store = _chain_store(tmp_path, parent_file=playlist)
    generate_task.process(store, _task())
    assert store.failed == [generate_task.SHOT_BEFORE]
    assert adapter.spec is None


def test_after_is_validated_like_sql():
    model = get_model("fal-seedance")
    base = {"prompt": "x", "aspectRatio": "9:16", "duration": 5}
    validate_spec(model, {**base, "after": "a" * 64})
    with pytest.raises(SpecError, match="Invalid generation request"):
        validate_spec(model, {**base, "after": "nope"})
    with pytest.raises(SpecError, match="cannot also start from an image"):
        validate_spec(model, {**base, "after": "a" * 64, "startImage": "user-1/a.png"})
    with pytest.raises(SpecError, match="does not take"):
        validate_spec(get_model("fal-nano-banana"), {"prompt": "x", "aspectRatio": "1:1", "after": "a" * 64})


def test_explainer_tai_code_cua_dung_nguoi(monkeypatch):
    # Explainers carry only code_ref too; the code is loaded for the task's owner.
    beats = [{"say": "One."}, {"say": "Two."}, {"say": "Three."}]
    spec = {
        "prompt": "Shazam", "aspectRatio": "16:9", "duration": 15, "voice": "Aria",
        "scene": {"template": "explainer", "code_ref": "d" * 64, "title": "Shazam", "beats": beats},
    }
    seen = {}

    class Adapter:
        def run(self, model, spec, workdir, alive):
            seen["code"] = spec.get("code")
            raise generate_task.ProviderError("stop here")

    monkeypatch.setattr(generate_task, "adapter_for", lambda model: Adapter())
    store = FakeStore(_generation(model="motion-explainer", spec=spec, spec_hash=generate_task.spec_hash("motion-explainer", spec)))
    store.codes = {("user-2", "d" * 64): "return function Scene() { return null; };"}
    generate_task.process(store, _task())
    assert store.failed == ["This explainer code was not found. Preview it again."]
    assert seen == {}

    store = FakeStore(_generation(model="motion-explainer", spec=spec, spec_hash=generate_task.spec_hash("motion-explainer", spec)))
    store.codes = {("user-1", "d" * 64): "return function Scene() { return null; };"}
    generate_task.process(store, _task())
    assert seen["code"].startswith("return function Scene")


@pytest.mark.parametrize(("model_id", "kept"), [("motion-explainer", True), ("fake-video", False)])
def test_explainer_words_go_to_complete_generation(monkeypatch, tmp_path, model_id, kept):
    words = [{"text": "One.", "start": 0.0, "end": 0.4}]
    spec = {"prompt": "x", "aspectRatio": "16:9", "duration": 5}
    if model_id == "motion-explainer":
        spec |= {"duration": 15, "voice": "Aria", "scene": {"template": "explainer", "code_ref": "d" * 64, "title": "Shazam",
                                             "beats": [{"say": "One."}, {"say": "Two."}, {"say": "Three."}]}}
    video = tmp_path / "out.mp4"
    video.write_bytes(b"mp4")

    class Adapter:
        def run(self, model, spec, workdir, alive):
            return Result(video, "video/mp4", "mp4", words=words)

        def cost(self, model, spec, result):
            return 1

    monkeypatch.setattr(generate_task, "adapter_for", lambda model: Adapter())
    monkeypatch.setattr(generate_task, "check_output", lambda *a: None)
    monkeypatch.setattr(generate_task, "_probe", lambda path: (15.0, 1920, 1080))
    store = FakeStore(_generation(model=model_id, spec=spec, spec_hash=generate_task.spec_hash(model_id, spec)))
    store.codes = {("user-1", "d" * 64): "return function Scene() { return null; };"}
    generate_task.process(store, _task())
    assert store.failed == []
    assert store.completed["words"] == (words if kept else None)


def test_kiem_duyet_bo_qua_explainer_cua_minh():
    from opencmo.ai.catalog import get_model
    from opencmo.ai.moderation import needs_check

    assert not needs_check(get_model("motion-explainer")), "our own renderer: the script was checked on the web"
