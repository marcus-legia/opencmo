"""Provider `opencmo-motion` (explainers): spec and price rules, the voice → job → CLI path, and
the Modal path with a fake SDK. The CLI is replaced by a fake `subprocess.run`: no Chromium needed."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from opencmo.ai import catalog
from opencmo.ai.catalog import SpecError, get_model, validate_spec
from opencmo.ai.providers import adapter_for, motion
from opencmo.ai.providers.base import ProviderError, Result
from opencmo.ai.providers.fake import FakeProvider
from opencmo.ai.providers.motion import MotionLocalProvider, MotionModalProvider, motion_job

BEATS = [
    {"say": "A noisy bar, and a song you half know.", "label": "Noisy bar"},
    {"say": "Shazam turns the sound into a map of peaks."},
    {"say": "Pairs of peaks become fingerprints.", "label": "f1 | f2 | gap"},
    {"say": "One match in millions, in under a second.", "label": "Match"},
]
SPEC = {
    "prompt": "Explainer: How Shazam hears a song",
    "aspectRatio": "16:9",
    "duration": 20,
    "voice": "Aria",
    "scene": {"template": "explainer", "code_ref": "e" * 64, "title": "How Shazam hears a song", "beats": BEATS},
}
CODE = "return function Scene() { return null; };"


def model():
    return get_model("motion-explainer")


def test_spec_hop_le_va_chi_model_explainer_nhan_no() -> None:
    validate_spec(model(), SPEC)
    validate_spec(model(), {**SPEC, "seed": 3, "scene": {**SPEC["scene"], "accent": "#12ABef"}})
    validate_spec(model(), {**SPEC, "scene": {**SPEC["scene"], "theme": "paper", "personality": "playful"}})
    with pytest.raises(SpecError, match="Describe the 3D scene"):
        validate_spec(get_model("studio-3d"), {k: v for k, v in SPEC.items() if k != "voice"} | {"duration": 5, "aspectRatio": "9:16"})
    with pytest.raises(SpecError, match="does not take"):
        validate_spec(get_model("studio-3d"), {**SPEC, "duration": 5, "aspectRatio": "9:16"})


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"voice": "Someone Real"}, "listed voices"),
        ({"voice": None}, "listed voices"),
        ({"duration": 12}, "does not support that duration"),
        ({"duration": 95}, "does not support that duration"),
        ({"aspectRatio": "4:5"}, "aspect ratio"),
        ({"scene": {**SPEC["scene"], "template": "code"}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "code_ref": "nope"}}, "explainer code was not found"),
        ({"scene": {**SPEC["scene"], "beats": BEATS[:2]}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "beats": [*BEATS, {"say": " "}]}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "beats": [*BEATS, {"say": "x" * 241}]}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "beats": [*BEATS, {"say": "ok", "colour": "red"}]}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "title": ""}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "accent": "red"}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "theme": "neon"}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "theme": None}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "personality": "Playful"}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "beats": [*BEATS[:3], {**BEATS[3], "visual": "a match"}]}}, "explainer script is not valid"),
        ({"scene": {**SPEC["scene"], "beats": [{"say": "x" * 240}] * 16}}, "too much data"),
    ],
)
def test_spec_hong_bi_chan(change: dict, message: str) -> None:
    spec = {**SPEC, **change}
    if change.get("voice", "") is None:
        spec.pop("voice")
    with pytest.raises(SpecError, match=message):
        validate_spec(model(), spec)


def test_gia_theo_thoi_luong_va_loi_doc() -> None:
    # 1 credit per started 10 s + 5 per started 1,000 characters of narration.
    assert catalog.price_of(model(), SPEC) == 2 + 5
    assert catalog.price_of(model(), {**SPEC, "duration": 25}) == 3 + 5
    long = {**SPEC, "duration": 90, "scene": {**SPEC["scene"], "beats": [{"say": "y" * 200}] * 6}}
    assert len(catalog.narration(long["scene"])) == 1205
    assert catalog.price_of(model(), long) == 9 + 10


def test_adapter_theo_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("OPENCMO_MOTION", "OPENCMO_AI_FAKE", "OPENCMO_MOTION_FAKE_VOICE", "ELEVENLABS_API_KEY", "OPENCMO_ENV"):
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(SpecError, match="not set up"):
        adapter_for(model())
    monkeypatch.setenv("OPENCMO_AI_FAKE", "1")
    assert isinstance(adapter_for(model()), FakeProvider)
    monkeypatch.setenv("OPENCMO_MOTION", "local")
    with pytest.raises(SpecError, match="not set up"):
        adapter_for(model())  # no voice: neither an ElevenLabs key nor the fake voice
    monkeypatch.setenv("OPENCMO_MOTION_FAKE_VOICE", "1")
    assert isinstance(adapter_for(model()), MotionLocalProvider)
    monkeypatch.setenv("OPENCMO_ENV", "production")
    with pytest.raises(SpecError, match="not set up"):
        adapter_for(model())  # the fake voice never runs in production
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    assert isinstance(adapter_for(model()), MotionLocalProvider)


def test_job_dung_hop_dong_motion_job() -> None:
    job = motion_job({**SPEC, "seed": 9, "code": CODE, "scene": {**SPEC["scene"], "accent": "#ff8800"}})
    assert job == {
        "title": "How Shazam hears a song",
        "code": CODE,
        "beats": [{"say": b["say"], **({"label": b["label"]} if "label" in b else {})} for b in BEATS],
        "format": "16:9",
        "duration": 20,
        "seed": 9,
        "accent": "#ff8800",
    }
    v2 = motion_job({**SPEC, "code": CODE, "scene": {**SPEC["scene"], "theme": "paper", "personality": "energetic"}})
    assert (v2["theme"], v2["personality"]) == ("paper", "energetic")
    assert "theme" not in job and "personality" not in job, "v1 scenes keep the renderer's defaults"
    words = [{"text": "A", "start": 0.0, "end": 0.2}]
    assert motion_job({**SPEC, "code": CODE}, words)["words"] == words
    assert "words" not in motion_job({**SPEC, "code": CODE}, None)


class _Voice:
    """Stands in for FalProvider: writes an audio file and returns word timings."""

    def __init__(self, words: list[dict]) -> None:
        self.words = words
        self.calls: list[tuple[str, dict]] = []

    def run(self, voice_model, spec, workdir):
        self.calls.append((voice_model.id, spec))
        path = workdir / "result.m4a"
        path.write_bytes(b"audio")
        return Result(path, "audio/mp4", "m4a", words=self.words)


def _fake_cli(monkeypatch: pytest.MonkeyPatch, code: int = 0, stderr: str = "") -> list[dict]:
    seen: list[dict] = []
    real_run = subprocess.run

    def fake_run(args, **kwargs):
        if args[0] != "node":
            return real_run(args, **kwargs)  # ffmpeg (the silent track) runs for real
        assert args[:3] == ["node", str(motion.CLIP_MOTION), "render"]
        seen.append({"args": args, "job": json.loads(Path(args[3]).read_text())})
        if code == 0:
            Path(args[4]).write_bytes(b"\x00\x00\x00\x18ftypmp42")
        return subprocess.CompletedProcess(args, code, '{"frames":600,"seconds":20,"msPerFrame":80}', stderr)

    monkeypatch.setattr(motion.subprocess, "run", fake_run)
    return seen


def test_local_giong_that_mang_words_vao_job(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("OPENCMO_MOTION_FAKE_VOICE", raising=False)
    seen = _fake_cli(monkeypatch)
    words = [{"text": "A", "start": 0.1, "end": 0.3}, {"text": "noisy", "start": 0.35, "end": 0.7}]
    voice = _Voice(words)
    result = MotionLocalProvider(voice).run(model(), {**SPEC, "code": CODE}, tmp_path)
    assert result is not None and result.content_type == "video/mp4"
    assert voice.calls == [("elevenlabs-voice", {"prompt": catalog.narration(SPEC["scene"]), "voice": "Aria"})]
    assert seen[0]["job"]["words"] == words
    assert seen[0]["args"][5:] == ["--audio", str(tmp_path / "voice" / "result.m4a")]
    assert result.words == words, "the words go back with the video for its captions"


def test_loi_doc_dai_hon_video_thi_cat_giong(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("OPENCMO_MOTION_FAKE_VOICE", raising=False)
    seen = _fake_cli(monkeypatch)
    cuts: list[list[str]] = []
    monkeypatch.setattr(motion, "run", lambda args, **k: cuts.append(args))
    words = [
        {"text": "early", "start": 1.0, "end": 1.5},
        {"text": "edge", "start": 19.8, "end": 20.4},
        {"text": "late", "start": 20.5, "end": 21.0},
    ]
    MotionLocalProvider(_Voice(words)).run(model(), {**SPEC, "code": CODE}, tmp_path)
    assert cuts and cuts[0][cuts[0].index("-t") + 1] == "20"
    assert "-format_whitelist" in cuts[0], "the provider's audio is read like an upload"
    assert seen[0]["job"]["words"] == [
        {"text": "early", "start": 1.0, "end": 1.5},
        {"text": "edge", "start": 19.8, "end": 20.0},
    ]
    assert seen[0]["args"][-1] == str(tmp_path / "voice-cut.m4a")


def test_giong_gia_la_im_lang_va_khong_co_words(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENCMO_MOTION_FAKE_VOICE", "1")
    monkeypatch.delenv("OPENCMO_ENV", raising=False)
    seen = _fake_cli(monkeypatch)
    voice = _Voice([])
    result = MotionLocalProvider(voice).run(model(), {**SPEC, "code": CODE}, tmp_path)
    assert voice.calls == [], "no paid voice"
    assert result is not None and result.words is None, "no words: the editor adds no captions"
    assert "words" not in seen[0]["job"], "the renderer estimates the timings"
    assert (tmp_path / "voice.m4a").stat().st_size > 0


@pytest.mark.parametrize(
    ("code", "stderr", "message"),
    [
        (4, "compile\nSyntaxError: Unexpected token (3:7).", "The explainer code failed: SyntaxError: Unexpected token (3:7). Your credits were refunded."),
        (3, "job: beats too short", motion.INVALID),
        (1, "chromium crashed", motion.FAILED),
    ],
)
def test_ma_thoat_cua_cli(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, code: int, stderr: str, message: str) -> None:
    monkeypatch.setenv("OPENCMO_MOTION_FAKE_VOICE", "1")
    monkeypatch.delenv("OPENCMO_ENV", raising=False)
    _fake_cli(monkeypatch, code, stderr)
    with pytest.raises(ProviderError) as info:
        MotionLocalProvider().run(model(), {**SPEC, "code": CODE}, tmp_path)
    assert str(info.value) == message
    assert not info.value.retryable


class _Call:
    def __init__(self, results: list[object]) -> None:
        self.object_id = "fc-9"
        self._results = results

    def get(self, timeout: float = 0) -> object:
        value = self._results.pop(0)
        if isinstance(value, BaseException):
            raise value
        return value


def _modal(call: _Call, spawned: list[dict]) -> SimpleNamespace:
    def spawn(payload: dict) -> _Call:
        spawned.append(payload)
        return call

    return SimpleNamespace(
        Function=SimpleNamespace(from_name=lambda app, name: SimpleNamespace(spawn=spawn)),
        FunctionCall=SimpleNamespace(from_id=lambda ref: call),
    )


def test_modal_giong_o_worker_render_tren_modal(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("OPENCMO_MOTION_FAKE_VOICE", raising=False)
    spawned: list[dict] = []
    words = [{"text": "A", "start": 0.1, "end": 0.3}]
    call = _Call([TimeoutError(), b"\x00\x00\x00\x18ftypmp42"])
    adapter = MotionModalProvider(_modal(call, spawned), voice=_Voice(words))
    result = adapter.run(model(), {**SPEC, "code": CODE}, tmp_path, sleep=lambda _: None)
    assert result is not None and result.path.read_bytes().startswith(b"\x00\x00\x00\x18ftyp")
    assert spawned[0]["audio"] == b"audio"
    assert spawned[0]["job"] == motion_job({**SPEC, "code": CODE}, words)
    assert result.words == words


def test_modal_giu_cau_loi_code(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENCMO_MOTION_FAKE_VOICE", raising=False)
    failed = motion.code_failed("ReferenceError: foo is not defined")
    for error, message in ((ProviderError(failed), failed), (RuntimeError("OOM"), motion.FAILED)):
        adapter = MotionModalProvider(_modal(_Call([error]), []), voice=_Voice([]))
        with pytest.raises(ProviderError) as info:
            adapter.run(model(), {**SPEC, "code": CODE}, tmp_path, sleep=lambda _: None)
        assert str(info.value) == message


def test_modal_khong_spawn_duoc_thi_thu_lai(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENCMO_MOTION_FAKE_VOICE", raising=False)

    def broken(app, name):
        raise ConnectionError("modal down")

    functions = SimpleNamespace(Function=SimpleNamespace(from_name=broken))
    with pytest.raises(ProviderError) as info:
        MotionModalProvider(functions, voice=_Voice([])).run(model(), {**SPEC, "code": CODE}, tmp_path)
    assert info.value.retryable


def test_render_bytes_cua_ham_modal(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    seen = _fake_cli(monkeypatch)
    job = motion_job({**SPEC, "code": CODE})
    data = motion.render_bytes({"job": job, "audio": b"voice"}, tmp_path)
    assert data.startswith(b"\x00\x00\x00\x18ftyp")
    assert seen[0]["job"] == job
    assert (tmp_path / "voice.m4a").read_bytes() == b"voice"


def test_preview_tra_anh_base64_va_chan_file_ngoai_thu_muc(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    job = motion_job({**SPEC, "code": CODE})

    def fake_run(args, **kwargs):
        outdir = Path(args[4])
        (outdir / "s0.jpg").write_bytes(b"\xff\xd8jpeg")
        stills = [{"t": 1.5, "file": "s0.jpg"}]
        return subprocess.CompletedProcess(args, 0, json.dumps({"ok": True, "stills": stills, "issues": ["Label overlaps"], "estimated": True}), "")

    monkeypatch.setattr(motion.subprocess, "run", fake_run)
    result = motion.preview_local(job, tmp_path)
    assert result["ok"] and result["issues"] == ["Label overlaps"]
    assert result["images"] == ["/9hqcGVn"]
    assert result["stills"] == [{"t": 1.5, "file": "s0.jpg"}]

    def escaping(args, **kwargs):
        return subprocess.CompletedProcess(args, 0, json.dumps({"ok": True, "stills": [{"t": 0, "file": "/etc/passwd"}], "issues": [], "estimated": True}), "")

    monkeypatch.setattr(motion.subprocess, "run", escaping)
    with pytest.raises(RuntimeError):
        motion.preview_local(job, tmp_path)


def test_preview_loi_code_tra_ve_cho_agent(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    job = motion_job({**SPEC, "code": CODE})
    failed = {"ok": False, "phase": "guard", "message": "fetch is not allowed (line 2)"}
    monkeypatch.setattr(motion.subprocess, "run", lambda args, **k: subprocess.CompletedProcess(args, 4, json.dumps(failed), "fetch is not allowed (line 2)"))
    assert motion.preview_local(job, tmp_path) == failed
    monkeypatch.setattr(motion.subprocess, "run", lambda args, **k: subprocess.CompletedProcess(args, 4, "", "boom\nTypeError: x is undefined"))
    assert motion.preview_local(job, tmp_path) == {"ok": False, "phase": "render", "message": "TypeError: x is undefined"}


def test_cli_khong_nhan_khoa_cua_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "secret")
    monkeypatch.setenv("FAL_KEY", "secret")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "secret")
    monkeypatch.setenv("OPENCMO_MOTION_SCALE", "0.5")
    env = motion.cli_env()
    assert "SUPABASE_SERVICE_ROLE_KEY" not in env and "FAL_KEY" not in env and "ELEVENLABS_API_KEY" not in env
    assert env["OPENCMO_MOTION_SCALE"] == "0.5" and "PATH" in env


@pytest.mark.parametrize(("cores", "expected"), [(1, "1"), (2, "2"), (4, "4"), (64, "4"), (None, "1")])
def test_concurrency_follows_the_cores_capped_at_4(monkeypatch: pytest.MonkeyPatch, cores: int | None, expected: str) -> None:
    monkeypatch.delenv("OPENCMO_MOTION_CONCURRENCY", raising=False)
    monkeypatch.setattr(motion.os, "cpu_count", lambda: cores)
    assert motion.cli_env()["OPENCMO_MOTION_CONCURRENCY"] == expected


def test_concurrency_set_by_env_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENCMO_MOTION_CONCURRENCY", "3")
    monkeypatch.setattr(motion.os, "cpu_count", lambda: 1)
    assert motion.cli_env()["OPENCMO_MOTION_CONCURRENCY"] == "3"


_FAKE_SERVE = """
import json, os, sys, time
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    title = request["job"]["title"]
    if title == "crash":
        sys.exit(1)
    if title == "slow":
        time.sleep(30)
    if title == "bad code":
        print(json.dumps({"ok": False, "phase": "render", "message": "ReferenceError: x"}), flush=True)
        continue
    name = "/etc/passwd" if title == "escape" else "s0.jpg"
    if name == "s0.jpg":
        open(os.path.join(request["outdir"], name), "wb").write(b"jpg")
    print("console noise", file=sys.stderr)
    print(json.dumps({"ok": True, "stills": [{"t": 1, "file": name}], "issues": [str(os.getpid())], "estimated": True}), flush=True)
"""


@pytest.fixture
def serve(tmp_path: Path):
    script = tmp_path / "serve.py"
    script.write_text(_FAKE_SERVE)
    sessions: list[motion.PreviewSession] = []

    def make(timeout: float = 10) -> motion.PreviewSession:
        session = motion.PreviewSession([sys.executable, str(script)], timeout=timeout)
        sessions.append(session)
        return session

    yield make
    for session in sessions:
        session.close()


def _job(title: str) -> dict:
    return {"title": title, "code": CODE, "beats": BEATS, "format": "16:9", "duration": 20}


def _workdir(tmp_path: Path, name: str) -> Path:
    path = tmp_path / name
    path.mkdir()
    return path


def test_preview_session_opens_once_and_reuses_the_process(serve, tmp_path: Path) -> None:
    session = serve()
    assert session.start() > 0
    assert session.start() == 0, "already warm"
    first = session.preview(_job("one"), _workdir(tmp_path, "a"))
    second = session.preview(_job("two"), _workdir(tmp_path, "b"))
    assert first["images"] == ["anBn"] and first["stills"] == [{"t": 1, "file": "s0.jpg"}]
    assert first["issues"] == second["issues"], "same process for both previews"


def test_preview_session_returns_code_errors_for_the_agent(serve, tmp_path: Path) -> None:
    result = serve().preview(_job("bad code"), _workdir(tmp_path, "a"))
    assert result == {"ok": False, "phase": "render", "message": "ReferenceError: x"}


def test_preview_session_restarts_after_a_crash(serve, tmp_path: Path) -> None:
    session = serve()
    with pytest.raises(RuntimeError, match="preview failed"):
        session.preview(_job("crash"), _workdir(tmp_path, "a"))
    assert session.preview(_job("again"), _workdir(tmp_path, "b"))["ok"]


def test_preview_session_kills_a_slow_preview_and_starts_fresh(serve, tmp_path: Path) -> None:
    session = serve(timeout=1)
    warm = session.preview(_job("one"), _workdir(tmp_path, "a"))
    assert session.preview(_job("slow"), _workdir(tmp_path, "b")) == motion.PREVIEW_TOO_LONG
    fresh = session.preview(_job("two"), _workdir(tmp_path, "c"))
    assert fresh["issues"] != warm["issues"], "a new process after the timeout"


def test_preview_session_refuses_files_outside_the_preview_folder(serve, tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="preview failed"):
        serve().preview(_job("escape"), _workdir(tmp_path, "a"))


# --- Images in scenes (kit.Image): the worker inlines the user's own library images ---

USER = "11111111-1111-4111-8111-111111111111"


class _Library:
    """The `media` bucket of one user: `download_object` copies a local file, records what was asked."""

    def __init__(self, files: dict[str, Path]) -> None:
        self.files = files
        self.asked: list[str] = []

    def download_object(self, bucket: str, path: str, dest: Path, *, max_bytes: int | None = None) -> Path:
        assert bucket == "media"
        self.asked.append(path)
        if path not in self.files:
            raise FileNotFoundError(path)
        dest.write_bytes(self.files[path].read_bytes())
        return dest


def _image(tmp_path: Path, name: str, source: str, size: str) -> Path:
    out = tmp_path / name
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"{source}=s={size}", "-frames:v", "1", str(out)],
        check=True,
    )
    return out


def _decoded(asset: dict) -> bytes:
    import base64

    return base64.b64decode(asset["src"].split(",", 1)[1])


def test_motion_assets_refuse_another_users_path(tmp_path: Path) -> None:
    task = SimpleNamespace(user_id=USER)
    library = _Library({})
    for ref in ("22222222-2222-4222-8222-222222222222/logo.png", f"{USER}/../other/logo.png", f"{USER}\\..\\x.png", 42):
        with pytest.raises(SpecError, match="not in your library"):
            motion.motion_assets(library, task, {"assets": [{"name": "logo", "ref": ref}]}, tmp_path)
    assert library.asked == [], "nothing is downloaded for a path the task's owner does not own"
    for assets in (
        [{"name": f"a{i}", "ref": f"{USER}/a.png"} for i in range(7)],
        [{"name": "Logo", "ref": f"{USER}/a.png"}],
        [{"name": "a", "ref": f"{USER}/a.png"}, {"name": "a", "ref": f"{USER}/b.png"}],
    ):
        with pytest.raises(SpecError, match="not in your library"):
            motion.motion_assets(library, task, {"assets": assets}, tmp_path)
    with pytest.raises(SpecError, match="not in your library"):
        motion.motion_assets(library, task, {"assets": [{"name": "gone", "ref": f"{USER}/gone.png"}]}, tmp_path)


def test_motion_assets_keep_transparency_as_png(tmp_path: Path) -> None:
    logo = tmp_path / "logo.png"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=300x200,format=rgba", "-frames:v", "1", str(logo)],
        check=True,
    )
    library = _Library({f"{USER}/brand/logo.png": logo})
    [asset] = motion.motion_assets(library, SimpleNamespace(user_id=USER), {"assets": [{"name": "logo", "ref": f"{USER}/brand/logo.png"}]}, tmp_path)
    assert asset["name"] == "logo" and asset["src"].startswith("data:image/png;base64,")
    assert (asset["width"], asset["height"]) == (300, 200)
    data = _decoded(asset)
    assert data[25] == 6, "colour type 6: RGBA, the logo keeps its alpha"


def test_motion_assets_without_alpha_become_jpeg_under_2048_px(tmp_path: Path) -> None:
    shot = _image(tmp_path, "shot.png", "testsrc2", "3000x1500")
    webp = _image(tmp_path, "small.jpg", "testsrc2", "640x360")
    library = _Library({f"{USER}/uploads/shot.png": shot, f"{USER}/uploads/small.jpg": webp})
    assets = motion.motion_assets(
        library,
        SimpleNamespace(user_id=USER),
        {"assets": [{"name": "shot", "ref": f"{USER}/uploads/shot.png"}, {"name": "small", "ref": f"{USER}/uploads/small.jpg"}]},
        tmp_path,
    )
    assert [a["name"] for a in assets] == ["shot", "small"]
    assert all(a["src"].startswith("data:image/jpeg;base64,") for a in assets)
    assert (assets[0]["width"], assets[0]["height"]) == (2048, 1024)
    assert (assets[1]["width"], assets[1]["height"]) == (640, 360)
    assert all(len(_decoded(a)) <= motion.ASSET_MAX_BYTES and _decoded(a)[:3] == b"\xff\xd8\xff" for a in assets)


def test_motion_assets_refuse_a_file_that_is_not_an_image(tmp_path: Path) -> None:
    playlist = tmp_path / "x.png"
    playlist.write_text("#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n")
    library = _Library({f"{USER}/x.png": playlist})
    with pytest.raises(SpecError, match="could not be read"):
        motion.motion_assets(library, SimpleNamespace(user_id=USER), {"assets": [{"name": "x", "ref": f"{USER}/x.png"}]}, tmp_path)


def test_the_job_carries_the_inlined_assets() -> None:
    assets = [{"name": "logo", "src": "data:image/png;base64,AAAA", "width": 1, "height": 1}]
    assert motion_job({**SPEC, "code": CODE, "motionAssets": assets})["assets"] == assets
    assert "assets" not in motion_job({**SPEC, "code": CODE})


def test_the_worker_inlines_scene_images_before_the_render(tmp_path: Path) -> None:
    from opencmo.worker import generate_task

    shot = _image(tmp_path, "shot.png", "testsrc2", "320x180")
    library = _Library({f"{USER}/uploads/shot.png": shot})
    spec = {**SPEC, "code": CODE, "scene": {**SPEC["scene"], "assets": [{"name": "shot", "ref": f"{USER}/uploads/shot.png"}]}}
    prepared = generate_task._prepare_inputs(library, SimpleNamespace(user_id=USER), model(), spec, tmp_path)
    assert [a["name"] for a in prepared["motionAssets"]] == ["shot"]
    assert motion_job(prepared)["assets"][0]["src"].startswith("data:image/jpeg;base64,")
    assert "motionAssets" not in generate_task._prepare_inputs(library, SimpleNamespace(user_id=USER), model(), {**SPEC, "code": CODE}, tmp_path)


# --- Silent motion clips (motion quality B1/B2) ---

CLIP_SPEC = {
    "prompt": "Motion clip: Logo reveal",
    "aspectRatio": "16:9",
    "duration": 5,
    "scene": {
        "template": "clip",
        "code_ref": "c" * 64,
        "title": "Logo reveal",
        "beats": [{"say": "The mark lands.", "seconds": 2}, {"say": "The name rises.", "label": "OpenCMO", "seconds": 3}],
    },
}


def clip_model():
    return get_model("motion-clip")


def test_a_clip_spec_takes_timed_beats_and_no_voice() -> None:
    validate_spec(clip_model(), CLIP_SPEC)
    assert catalog.price_of(clip_model(), CLIP_SPEC) == 1
    assert catalog.price_of(clip_model(), {**CLIP_SPEC, "duration": 25}) == 3
    with pytest.raises(SpecError, match="settings the model does not take"):
        validate_spec(clip_model(), {**CLIP_SPEC, "voice": "Aria"})
    long = {**CLIP_SPEC, "duration": 30, "scene": {**CLIP_SPEC["scene"], "beats": [{"say": "a", "seconds": 16}, {"say": "b", "seconds": 15}]}}
    with pytest.raises(SpecError, match="longer than 30 seconds"):
        validate_spec(clip_model(), long)
    with pytest.raises(SpecError, match="motion clip is not valid"):
        validate_spec(clip_model(), {**CLIP_SPEC, "scene": {**CLIP_SPEC["scene"], "beats": [{"say": "No time."}]}})
    with pytest.raises(SpecError, match="motion clip is not valid"):
        validate_spec(clip_model(), {**CLIP_SPEC, "scene": {**CLIP_SPEC["scene"], "template": "explainer"}})
    with pytest.raises(SpecError, match="explainer script is not valid"):
        validate_spec(model(), {**CLIP_SPEC, "voice": "Aria", "duration": 15})


class _NoVoice:
    def run(self, *_args, **_kwargs):
        raise AssertionError("a silent clip must not make a voice")


def test_a_clip_renders_without_calling_the_voice(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    seen = _fake_cli(monkeypatch)
    provider = MotionLocalProvider(voice=_NoVoice())
    ref = provider.submit(clip_model(), {**CLIP_SPEC, "code": CODE}, tmp_path)
    assert provider.fetch(ref, tmp_path).words is None
    [call] = seen
    assert "--audio" not in call["args"]
    job = call["job"]
    assert job["kind"] == "clip" and "words" not in job
    assert job["beats"] == [{"say": "The mark lands.", "seconds": 2}, {"say": "The name rises.", "label": "OpenCMO", "seconds": 3}]


def test_a_clip_on_modal_sends_no_audio(tmp_path: Path) -> None:
    sent: list[dict] = []
    functions = SimpleNamespace(
        Function=SimpleNamespace(from_name=lambda *_: SimpleNamespace(spawn=lambda payload: sent.append(payload) or SimpleNamespace(object_id="fc-1"))),
    )
    MotionModalProvider(functions=functions, voice=_NoVoice()).submit(clip_model(), {**CLIP_SPEC, "code": CODE}, tmp_path)
    assert "audio" not in sent[0] and sent[0]["job"]["kind"] == "clip"


_CLIP_MOTION_READY = (Path(motion.CLIP_MOTION).parent.parent / "node_modules").exists() or (Path(motion.CLIP_MOTION).parents[3] / "node_modules" / "remotion").exists()


@pytest.mark.skipif(not _CLIP_MOTION_READY or not Path("/opt/pw-browsers").exists(), reason="needs clip-motion's Node deps and Chromium")
def test_a_clip_mp4_has_no_audio_stream(tmp_path: Path) -> None:
    code = "return function Scene() { return <kit.Stage><kit.Icon name=\"rocket\" x={960} y={500} size={300} /></kit.Stage>; };"
    spec = {**CLIP_SPEC, "duration": 3, "code": code, "scene": {**CLIP_SPEC["scene"], "beats": [{"say": "Lift off.", "seconds": 3}]}}
    out = MotionLocalProvider(voice=_NoVoice()).submit(clip_model(), spec, tmp_path)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-f", "mov", "-show_entries", "stream=codec_type:format=duration", "-of", "json", out],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(probe.stdout)
    assert [stream["codec_type"] for stream in info["streams"]] == ["video"]
    assert abs(float(info["format"]["duration"]) - 3) < 0.1
