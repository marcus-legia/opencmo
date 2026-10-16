"""Task `capture_page` (C4): ownership, moderation, storage and the English refusals."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_capture_page import CHROMIUM, README, _html, _Server, needs_browser

from opencmo.ai.providers.base import ProviderError
from opencmo.backends.supabase import Task
from opencmo.capture.guard import Guard
from opencmo.capture.page import BLOCKED, NOT_ALLOWED, capture
from opencmo.worker import capture_page_task

CAPTURE = "6f1c2a52-58a2-4b4e-9d8b-1a2b3c4d5e6f"


class FakeStore:
    def __init__(self, root: Path, page: str, **row: object) -> None:
        self.root = root
        self.row = {"id": CAPTURE, "user_id": "user-1", "task_id": "task-1", "status": "pending", "url": page, **row}
        self.failed: str | None = None
        self.completed: tuple | None = None
        self.stored: dict[str, Path] = {}

    def get_page_capture(self, capture_id):
        return self.row if capture_id == CAPTURE else None

    def heartbeat_task(self, *_args):
        return True

    def replace_object(self, bucket, path, local, **_kwargs):
        target = self.root / bucket / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(Path(local).read_bytes())
        self.stored[f"{bucket}/{path}"] = target

    def remove_objects(self, bucket, paths):
        for path in paths:
            self.stored.pop(f"{bucket}/{path}", None)

    def complete_page_capture(self, task_id, attempt_id, title, width, height):
        self.completed = (task_id, attempt_id, title, width, height)
        return True

    def fail_task(self, _task_id, _attempt_id, error):
        self.failed = error
        return True


def _task(url: str, **payload: object) -> Task:
    return Task(
        id="task-1", user_id="user-1", kind="capture_page", status="running", attempt_id="attempt-1",
        payload={"capture_id": CAPTURE, "url": url, "width": 1280, "max_height": 8000, **payload},
    )


def _with_local_server(monkeypatch: pytest.MonkeyPatch, port: int) -> None:
    """The fixture server is on 127.0.0.1: open exactly that port for this test."""
    def local(spec):
        return capture(spec, Guard(allow=frozenset({("127.0.0.1", port)})),
                       executable_path=str(CHROMIUM) if CHROMIUM else None)
    monkeypatch.setattr(capture_page_task, "_local_capture", local)


@needs_browser
def test_captures_moderates_and_stores_under_the_users_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from opencmo.ai import moderation

    checked: list[list[Path]] = []
    monkeypatch.setattr(moderation, "ready", lambda: True)
    monkeypatch.setattr(moderation, "check_images",
                        lambda images, policy: checked.append([Path(p) for p in images]) or None)
    with _Server({"/": _html(README.replace("{extra}", ""))}) as server:
        _with_local_server(monkeypatch, server.port)
        url = server.base + "/"
        store = FakeStore(tmp_path, url)
        capture_page_task.process(store, _task(url))

    assert store.failed is None
    assert store.completed is not None
    task_id, attempt, title, width, height = store.completed
    assert (task_id, attempt, title, width) == ("task-1", "attempt-1", "owner/repo: skills for agents", 1280)
    assert set(store.stored) == {f"captures/user-1/{CAPTURE}/page.png", f"captures/user-1/{CAPTURE}/page.boxes.json"}
    boxes = json.loads(store.stored[f"captures/user-1/{CAPTURE}/page.boxes.json"].read_text())
    assert boxes["height"] == height and boxes["scale"] == 2 and boxes["runs"]
    # The whole page went through the check, at CSS scale, in tiles of at most 1600 px.
    assert len(checked) == 1 and len(checked[0]) == -(-height // capture_page_task.TILE_HEIGHT)
    assert all(tile.suffix == ".jpg" for tile in checked[0])


@needs_browser
def test_a_flagged_page_is_not_stored(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from opencmo.ai import moderation

    def flag(images, policy):
        raise ProviderError(moderation.BLOCKED)

    monkeypatch.setattr(moderation, "ready", lambda: True)
    monkeypatch.setattr(moderation, "check_images", flag)
    with _Server({"/": _html(README.replace("{extra}", ""))}) as server:
        _with_local_server(monkeypatch, server.port)
        url = server.base + "/"
        store = FakeStore(tmp_path, url)
        capture_page_task.process(store, _task(url))
    assert store.failed == BLOCKED
    assert store.stored == {} and store.completed is None


@needs_browser
@pytest.mark.parametrize("url", ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:3000/"])
def test_local_addresses_fail_in_plain_english(tmp_path: Path, url: str) -> None:
    store = FakeStore(tmp_path, url)
    capture_page_task.process(store, _task(url))
    assert store.failed == NOT_ALLOWED
    assert store.stored == {}


def test_production_without_moderation_keys_refuses(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from opencmo.ai import moderation

    monkeypatch.setattr(moderation, "ready", lambda: False)
    monkeypatch.setattr(moderation, "production", lambda: True)
    with pytest.raises(capture_page_task.TaskError, match=capture_page_task.NOT_CHECKED):
        capture_page_task.moderate(tmp_path / "page.png", 100, tmp_path)


@pytest.mark.parametrize("row", [{"user_id": "someone-else"}, {"task_id": "other-task"}, {"status": "ready"},
                                 {"url": "https://elsewhere.example.org/"}])
def test_only_its_own_pending_capture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, row: dict) -> None:
    monkeypatch.setattr(capture_page_task, "capture_page", lambda spec: pytest.fail("must not capture"))
    store = FakeStore(tmp_path, "https://github.com/owner/repo", **row)
    capture_page_task.process(store, _task("https://github.com/owner/repo"))
    assert store.failed == capture_page_task.UNAVAILABLE


def test_a_bad_spec_is_refused(tmp_path: Path) -> None:
    store = FakeStore(tmp_path, "https://github.com/owner/repo")
    capture_page_task.process(store, _task("https://github.com/owner/repo", max_height=999999))
    assert store.failed == capture_page_task.UNAVAILABLE


def test_production_never_captures_in_process(monkeypatch: pytest.MonkeyPatch) -> None:
    from opencmo.ai import moderation

    monkeypatch.delenv("OPENCMO_CAPTURE", raising=False)
    monkeypatch.setattr(moderation, "production", lambda: True)
    monkeypatch.setattr(capture_page_task, "_local_capture", lambda spec: pytest.fail("ran Chromium in the worker"))
    with pytest.raises(capture_page_task.TaskError, match=capture_page_task.NOT_CHECKED):
        capture_page_task.capture_page({"url": "https://x.example.org/", "width": 1280, "max_height": 8000})


def test_remote_errors_keep_their_sentence_and_others_become_not_opened(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENCMO_CAPTURE", "modal")
    monkeypatch.setattr(capture_page_task, "_remote_capture", lambda spec: (_ for _ in ()).throw(Exception(NOT_ALLOWED)))
    with pytest.raises(capture_page_task.TaskError, match=NOT_ALLOWED):
        capture_page_task.capture_page({"url": "https://x.example.org/", "width": 1280, "max_height": 8000})
    monkeypatch.setattr(capture_page_task, "_remote_capture", lambda spec: (_ for _ in ()).throw(RuntimeError("boom /etc")))
    with pytest.raises(capture_page_task.TaskError, match=capture_page_task.NOT_OPENED):
        capture_page_task.capture_page({"url": "https://x.example.org/", "width": 1280, "max_height": 8000})
