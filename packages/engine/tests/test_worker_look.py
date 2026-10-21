"""`look` for Claude over MCP (editor-MCP plan, item 1): ownership first, then the export's sources.

The Node drawing itself is covered by `packages/clip-export/src/look.test.ts`; here `_node` is
replaced so only the worker's part runs: who may look, which files are fetched, the waveform.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from opencmo.worker import look as look_mod

USER = "u-1"
CLIP = "c-1"
JOB = "j-1"


class FakeStore:
    def __init__(self, master: Path | None = None, owner: str = USER, has_master: bool = True) -> None:
        self.master = master
        self.owner = owner
        self.has_master = has_master
        self.downloads: list[tuple[str, str]] = []
        self.signed: list[tuple[str, str]] = []

    def get_clip(self, clip_id):
        return {"id": clip_id, "job_id": JOB} if clip_id == CLIP else None

    def get_job_row(self, job_id):
        if job_id != JOB:
            return None
        masters = {CLIP: {"bucket": "renders", "object": "u-1/j-1/master.mp4", "transcript": "u-1/j-1/t.json"}} if self.has_master else {}
        return {"id": JOB, "user_id": self.owner, "media_manifest": {"masters": masters}}

    def sign_object_url(self, bucket, name, expires_in=3600):
        # A local path stands in for the signed URL; HTTP reads are covered in test_user_media_inputs.
        self.signed.append((bucket, name))
        return str(self.master)

    def download_object(self, bucket, name, dest, max_bytes=None):
        self.downloads.append((bucket, name))
        Path(dest).write_bytes(self.master.read_bytes() if self.master else b"x")


@pytest.fixture
def media(tmp_path) -> Path:
    # 6 s: tone 0-2 s, silence 2-4 s, tone 4-6 s.
    path = tmp_path / "talk.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=s=64x64:d=6",
         "-f", "lavfi", "-i", "sine=f=440:d=6,volume='if(between(t,2,4),0,1)':eval=frame",
         "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", str(path)],
        check=True,
    )
    return path


def _request(op, **extra):
    return {"user_id": USER, "clip_id": CLIP, "op": op, "input": extra.pop("input", {}), **extra}


def test_someone_elses_clip_reads_as_not_found(tmp_path):
    store = FakeStore(owner="someone-else")
    assert look_mod.look(store, _request("waveform"), tmp_path) == {"error": look_mod.NOT_FOUND}
    assert store.downloads == []


def test_unknown_clip_and_unknown_op(tmp_path):
    assert look_mod.look(FakeStore(), {**_request("waveform"), "clip_id": "nope"}, tmp_path) == {"error": look_mod.NOT_FOUND}
    assert "Unknown" in look_mod.look(FakeStore(), _request("delete"), tmp_path)["error"]


def test_capture_streams_the_planned_video_instead_of_downloading_it(monkeypatch, tmp_path, media):
    calls: list[tuple] = []

    def fake_node(command, file, *rest, timeout):
        calls.append((command, *rest))
        if command == "plan":
            return json.dumps({"sources": [{"kind": "video", "src": "assets/master.mp4"}], "width": 1080, "height": 1920})
        spec = json.loads(Path(file).read_text())
        assert spec["op"] == "capture" and spec["times"] == [1.0, 2.0]
        assert spec["media"][0]["src"] == "assets/master.mp4" and Path(spec["media"][0]["file"]).exists()
        return json.dumps({"images": ["AAAA"], "data": {"times": spec["times"]}})

    monkeypatch.setattr(look_mod, "_node", fake_node)
    store = FakeStore(master=media)
    out = look_mod.look(store, _request("capture", document={"version": 1}, input={"times": [1.0, 2.0]}), tmp_path)
    assert out == {"images": ["AAAA"], "data": {"times": [1.0, 2.0]}}
    assert [c[0] for c in calls] == ["plan", "look"]
    assert store.signed == [("renders", "u-1/j-1/master.mp4")]
    assert store.downloads == [], "a look never downloads the whole master"


def test_frame_passes_only_its_own_fields(monkeypatch, tmp_path):
    seen = {}

    def fake_node(command, file, *rest, timeout):
        if command == "plan":
            return json.dumps({"sources": []})
        seen.update(json.loads(Path(file).read_text()))
        return json.dumps({"images": ["AAAA"], "data": {"time": 2}})

    monkeypatch.setattr(look_mod, "_node", fake_node)
    look_mod.look(FakeStore(), _request("frame", document={"version": 1}, input={"time": 2, "edge": 1280, "times": [1]}), tmp_path)
    assert seen["op"] == "frame" and seen["time"] == 2 and seen["edge"] == 1280 and "times" not in seen


def test_capture_without_a_document_asks_to_open_the_editor(tmp_path):
    assert "Open it in the editor" in look_mod.look(FakeStore(), _request("capture"), tmp_path)["error"]


def test_node_errors_come_back_as_sentences(monkeypatch, tmp_path):
    monkeypatch.setattr(look_mod, "_node", lambda command, *a, **k: json.dumps({"sources": []}) if command == "plan" else json.dumps({"error": '"x" is not visible at 0:01.0.'}))
    out = look_mod.look(FakeStore(), _request("inspect_color", document={"version": 1}, input={"time": 1, "element_id": "x"}), tmp_path)
    assert out == {"error": '"x" is not visible at 0:01.0.'}


def test_grab_needs_a_library_path_and_refuses_files_outside_the_project(tmp_path):
    assert "needs the library path" in look_mod.look(FakeStore(), _request("grab"), tmp_path)["error"]
    out = look_mod.look(FakeStore(), _request("grab", input={"path": "broll.mp4"}, manifest={"assets": []}), tmp_path)
    assert "not in this project's library" in out["error"]


def test_waveform_of_the_clip_video_finds_the_silence(tmp_path, media):
    out = look_mod.look(FakeStore(master=media), _request("waveform"), tmp_path)
    data = out["data"]
    assert data["path"] == "assets/master.mp4"
    assert len(data["levels_db"]) == look_mod.WAVEFORM_BUCKETS
    assert [(round(s["start"]), round(s["end"])) for s in data["silences"]] == [(2, 4)]
    # The tone sits near -18 dB (ffmpeg sine is 1/8 of full scale), the silence at the floor.
    assert max(data["levels_db"]) > -25 and min(data["levels_db"]) <= -59


def test_waveform_window_is_in_file_seconds(tmp_path, media):
    data = look_mod.waveform_of(media, 3.0, 6.0, -35, 0.4)
    assert data["start"] == 3.0 and data["end"] == 6.0
    assert [(round(s["start"]), round(s["end"])) for s in data["silences"]] == [(3, 4)]
    with pytest.raises(look_mod.LookError):
        look_mod.waveform_of(media, 5.0, 4.0, -35, 0.4)


def test_waveform_of_a_blank_edit_says_there_is_no_video(tmp_path):
    out = look_mod.look(FakeStore(has_master=False), _request("waveform"), tmp_path)
    assert out == {"error": look_mod.NO_VIDEO}


@pytest.mark.parametrize("bad", [{"start": "1"}, {"threshold_db": float("nan")}, {"min_silence": True}, {"path": 3}])
def test_waveform_refuses_malformed_input_with_a_sentence(tmp_path, media, bad):
    out = look_mod.look(FakeStore(master=media), _request("waveform", input=bad), tmp_path)
    assert set(out) == {"error"}


def test_waveform_levels_and_their_seconds_agree(tmp_path, media):
    data = look_mod.waveform_of(media, 0.0, 5.03, -35, 0.4)
    assert len(data["levels_db"]) <= look_mod.WAVEFORM_BUCKETS
    assert data["seconds_per_level"] == round(5.03 / len(data["levels_db"]), 3)


def test_waveform_reads_a_signed_url_by_seeking(tmp_path, media):
    import functools
    import http.server
    import threading

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(media.parent))
    handler.log_message = lambda *_args: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        data = look_mod.waveform_of(f"http://127.0.0.1:{server.server_address[1]}/{media.name}", 0.0, None, -35, 0.4)
    finally:
        server.shutdown()
    assert [(round(s["start"]), round(s["end"])) for s in data["silences"]] == [(2, 4)]
