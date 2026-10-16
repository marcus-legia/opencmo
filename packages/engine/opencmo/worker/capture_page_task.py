"""Task `capture_page` (docs/style-skills-build.md, C4): capture a public page for proof B-roll.

The capture runs somewhere else on purpose. The page's JavaScript runs in Chromium, so Chromium
must not share a container with this worker's secrets (worker token, service-role key): in
production the task calls the Modal function `page_capture`, which has none
(`OPENCMO_CAPTURE=modal`); a dev machine runs it in-process.

Here the task only does what needs the secrets: checks the capture is this task's, moderates
the screenshot, stores `page.png` + `page.boxes.json` in the private `captures` bucket under
`<user>/<capture>/`, and marks the capture ready (`complete_page_capture`). Every refusal is one
of the contract's English sentences; the trigger on `tasks` copies it to the capture.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

from opencmo.ai.providers.base import ProviderError
from opencmo.backends.supabase import Task
from opencmo.capture.page import BLOCKED, MAX_HEIGHT, MESSAGES, NOT_OPENED, TOO_LARGE, WIDTH
from opencmo.media.ffmpeg import run
from opencmo.worker.task_run import TaskContext, TaskError, run_task

log = logging.getLogger(__name__)

CAPTURES_BUCKET = "captures"
UNAVAILABLE = "That capture is no longer available."
NOT_CHECKED = "Page captures are not set up on this server yet."
UNCHECKED = "This page could not be checked. Please try again."

MODAL_APP = "opencmo"
MODAL_FUNCTION = "page_capture"
#: CSS pixels of page per moderation image; a capture is at most 8000 tall, so at most 5 images.
TILE_HEIGHT = 1600
#: Waits between tries of a busy content check.
CHECK_BACKOFF = (2.0, 5.0)
_sleep = time.sleep


def _spec(task: Task) -> dict[str, Any]:
    payload = task.payload or {}
    capture_id = payload.get("capture_id")
    url = payload.get("url")
    try:
        uuid.UUID(str(capture_id))
    except ValueError:
        raise TaskError(UNAVAILABLE) from None
    if (
        not isinstance(url, str)
        or not url.startswith(("http://", "https://"))
        or len(url) > 2048
        or payload.get("width") != WIDTH
        or not isinstance(payload.get("max_height"), int)
        or not 200 <= payload["max_height"] <= MAX_HEIGHT
    ):
        raise TaskError(UNAVAILABLE)
    return {"capture_id": str(capture_id), "url": url, "width": WIDTH, "max_height": payload["max_height"]}


def _remote_capture(spec: dict[str, Any]) -> dict[str, Any]:
    import modal

    function = modal.Function.from_name(MODAL_APP, MODAL_FUNCTION)
    return function.remote(spec)


def _local_capture(spec: dict[str, Any]) -> dict[str, Any]:
    from opencmo.capture.page import capture

    return capture(spec)


def capture_page(spec: dict[str, Any]) -> dict[str, Any]:
    """`{url, width, max_height}` → `{png, boxes}` from wherever captures run here."""
    target = _remote_capture if os.environ.get("OPENCMO_CAPTURE") == "modal" else _local_capture
    try:
        result = target({key: spec[key] for key in ("url", "width", "max_height")})
    except Exception as exc:
        message = str(exc)
        if message in MESSAGES:
            raise TaskError(message) from exc
        log.warning("Page capture failed: %s", message[:300])
        raise TaskError(NOT_OPENED) from exc
    if not isinstance(result, dict) or not isinstance(result.get("png"), (bytes, bytearray)) \
            or not isinstance(result.get("boxes"), dict):
        raise TaskError(NOT_OPENED)
    return result


def _check_boxes(boxes: dict[str, Any]) -> tuple[str, int]:
    """The few fields `add_proof` relies on, before anything is stored."""
    width, height, runs = boxes.get("width"), boxes.get("height"), boxes.get("runs")
    if width != WIDTH or not isinstance(height, int) or not 1 <= height <= MAX_HEIGHT \
            or boxes.get("scale") != 2 or not isinstance(runs, list):
        raise TaskError(NOT_OPENED)
    for run_ in runs:
        rect = run_.get("rect") if isinstance(run_, dict) else None
        if not isinstance(run_.get("text") if isinstance(run_, dict) else None, str) \
                or not isinstance(rect, list) or len(rect) != 4 \
                or not all(isinstance(value, (int, float)) for value in rect):
            raise TaskError(NOT_OPENED)
    return str(boxes.get("title") or "")[:300], height


def _tiles(png: Path, height: int, workdir: Path) -> list[Path]:
    """The page as JPEGs at CSS scale, `TILE_HEIGHT` tall: what the content check looks at.

    Streaming ffmpeg with the PNG demuxer named explicitly (the page chose the pixels, not the
    container, but the rule for media from outside holds anyway)."""
    tiles = []
    for index, top in enumerate(range(0, height, TILE_HEIGHT)):
        tile = workdir / f"tile-{index}.jpg"
        size = min(TILE_HEIGHT, height - top)
        run([
            "ffmpeg", "-v", "error", "-y", "-protocol_whitelist", "file", "-f", "png_pipe", "-i", str(png),
            "-vf", f"scale={WIDTH}:-2,crop={WIDTH}:{size}:0:{top}", "-frames:v", "1", "-q:v", "4", str(tile),
        ], timeout=120)
        tiles.append(tile)
    return tiles


def moderate(png: Path, height: int, workdir: Path) -> None:
    """Every part of the page goes through the image check; flagged → the capture fails."""
    from opencmo.ai import moderation

    if not moderation.ready():
        if moderation.production():
            raise TaskError(NOT_CHECKED)
        log.warning("Moderation keys missing: skipping the content check of a page capture")
        return
    tiles = _tiles(png, height, workdir)
    for wait in (*CHECK_BACKOFF, None):
        try:
            moderation.check_images(tiles, moderation.CAPTURE_POLICY)
            return
        except ProviderError as exc:
            if not exc.retryable:
                raise TaskError(BLOCKED) from exc
            if wait is None:
                raise TaskError(UNCHECKED) from exc
            _sleep(wait)


def process(store: Any, task: Task) -> None:
    run_task(store, task, name="capture", failed=NOT_OPENED, body=_run)


def _run(ctx: TaskContext) -> None:
    store, task = ctx.store, ctx.task
    spec = _spec(task)
    row = store.get_page_capture(spec["capture_id"])
    if (
        not row
        or row.get("user_id") != task.user_id
        or row.get("task_id") != task.id
        or row.get("status") != "pending"
        or row.get("url") != spec["url"]
    ):
        raise TaskError(UNAVAILABLE)

    result = capture_page(spec)
    if ctx.lost():
        return
    png_bytes: bytes = bytes(result["png"])
    if len(png_bytes) > 25 * 1024 * 1024:
        raise TaskError(TOO_LARGE)
    title, height = _check_boxes(result["boxes"])
    png = ctx.root / "page.png"
    png.write_bytes(png_bytes)
    del png_bytes, result["png"]
    boxes = ctx.root / "page.boxes.json"
    boxes.write_text(json.dumps(result["boxes"], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    moderate(png, height, ctx.root)
    if ctx.lost():
        return

    prefix = f"{task.user_id}/{spec['capture_id']}"
    # Fixed paths per capture: a second attempt overwrites the first one's files.
    for local, name, content_type in ((png, "page.png", "image/png"), (boxes, "page.boxes.json", "application/json")):
        store.replace_object(CAPTURES_BUCKET, f"{prefix}/{name}", local, content_type=content_type)
        ctx.uploaded(CAPTURES_BUCKET, f"{prefix}/{name}")
    ctx.complete(lambda: store.complete_page_capture(task.id, task.attempt_id, title, WIDTH, height))
