"""Look at a clip for Claude over MCP (editor-MCP plan, item 1): capture_frame, inspect_color, media_grab,
media_waveform.

The web app reads the clip's document and library manifest under the user's RLS and posts them
here with the worker token (`modal_app.look`). This module checks the clip belongs to that user,
downloads only the sources the asked frames need with the export's own rules (`_Sources`), and
hands drawing to the Node exporter (`clip-export look`, the renderer the export uses). Waveforms
are ffmpeg only. Nothing is stored and no video is encoded: a request is a few decoded frames.

Budgets: decoding happens in ffmpeg subprocesses (`clip-export` probes and decodes with `-ss`
before `-i`, behind the demuxer allowlist); no frame enters Python memory.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from opencmo.media.ffmpeg import USER_INPUT
from opencmo.worker.render_document_task import (
    CLIP_EXPORT,
    EDITOR_FONTS,
    EDITOR_LOTTIE,
    MASTER,
    SourceError,
    _node,
    _Sources,
)

log = logging.getLogger(__name__)

OPS = ("capture", "inspect_color", "frame", "grab", "waveform")
#: Well under Modal's 150 s web limit: a request decodes at most 12 frames.
NODE_TIMEOUT = 100
MAX_TIMES = 12
WAVEFORM_BUCKETS = 60
NOT_FOUND = "That clip was not found. Use list_clips to find its id."


class LookError(Exception):
    """A sentence for Claude: the request cannot be answered as asked."""


def _owned_clip(store: Any, user_id: str, clip_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    clip = store.get_clip(clip_id)
    job = store.get_job_row(str(clip.get("job_id"))) if clip else None
    if not clip or not job or job.get("user_id") != user_id:
        raise LookError(NOT_FOUND)
    return clip, job


def _sources(store: Any, user_id: str, clip: dict[str, Any], job: dict[str, Any], manifest: dict[str, Any], root: Path) -> _Sources:
    # `_Sources` reads only these fields of a task: the export's ownership rules apply as they are.
    task = SimpleNamespace(user_id=user_id, job_id=clip["job_id"], clip_id=clip["id"], payload={"manifest": manifest})
    return _Sources(store, task, job, root)  # type: ignore[arg-type]


def _render(spec: dict[str, Any], root: Path) -> dict[str, Any]:
    job_file = root / "look.json"
    job_file.write_text(json.dumps(spec), encoding="utf-8")
    out = _node("look", str(job_file), timeout=NODE_TIMEOUT)
    result = json.loads(out.strip().splitlines()[-1])
    if "error" in result:
        raise LookError(str(result["error"]))
    return result


def _document_job(store: Any, request: dict[str, Any], clip: dict[str, Any], job: dict[str, Any], root: Path) -> dict[str, Any]:
    document = request.get("document")
    if not isinstance(document, dict):
        raise LookError("This clip has no editable document yet. Open it in the editor once, then try again.")
    planned = root / "document.json"
    planned.write_text(json.dumps(document), encoding="utf-8")
    plan = json.loads(_node("plan", str(planned), "1080", timeout=60))
    sources = _sources(store, request["user_id"], clip, job, request.get("manifest") or {}, root)
    media: list[dict[str, Any]] = []
    transcripts: list[dict[str, Any]] = []
    for entry in plan["sources"]:
        if entry["kind"] == "transcript":
            transcripts.append({"src": entry["src"], "file": str(sources.transcript(entry["src"]))})
        else:
            media.append({"src": entry["src"], "file": str(sources.media(entry["src"]))})
    return {
        "document": document,
        "media": media,
        "transcripts": transcripts,
        "fonts": str(EDITOR_FONTS),
        "lottie": str(EDITOR_LOTTIE),
    }


def _db(value: float) -> float:
    return round(max(-60.0, value), 1)


def waveform_of(file: Path, start: float | None, end: float | None, threshold_db: float, min_silence: float) -> dict[str, Any]:
    """Coarse dB levels and the silent stretches of `file`, in the file's seconds.

    Two streaming ffmpeg passes over the audio only (`-vn`): `astats` per bucket and
    `silencedetect`. `-ss` before `-i` when a window is asked.
    """
    probe = subprocess.run(
        ["ffprobe", "-v", "error", *USER_INPUT, "-show_entries", "format=duration", "-of", "csv=p=0", str(file)],
        capture_output=True, text=True, timeout=30, check=False,
    )
    try:
        total = float(probe.stdout.strip() or 0)
    except ValueError:
        total = 0.0
    if total <= 0:
        raise LookError("No sound could be read from this file.")
    begin = max(0.0, start or 0.0)
    finish = min(total, end if end is not None else total)
    if finish <= begin:
        raise LookError("start must be before end, inside the file.")
    span = finish - begin
    window = ["-ss", f"{begin:.3f}", *USER_INPUT, "-i", str(file), "-t", f"{span:.3f}", "-vn"]
    bucket = span / WAVEFORM_BUCKETS
    # One astats reset per bucket: peak level of each slice, printed as frame metadata.
    levels_run = subprocess.run(
        ["ffmpeg", "-v", "error", *window, "-af",
         (f"aresample=8000,asetnsamples=n={max(1, round(bucket * 8000))}:p=0,astats=metadata=1:reset=1,"
          "ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-"),
         "-f", "null", "-"],
        capture_output=True, text=True, timeout=120, check=False,
    )
    levels: list[float] = []
    for line in levels_run.stdout.splitlines():
        if "Peak_level=" in line:
            raw = line.split("=", 1)[1].strip()
            levels.append(_db(float(raw)) if raw not in ("-inf", "inf", "nan") else -60.0)
    if not levels:
        raise LookError("No sound could be read from this file.")
    silence_run = subprocess.run(
        ["ffmpeg", "-v", "info", "-nostats", *window, "-af", f"silencedetect=noise={threshold_db}dB:d={min_silence}", "-f", "null", "-"],
        capture_output=True, text=True, timeout=120, check=False,
    )
    silences: list[dict[str, float]] = []
    opened: float | None = None
    for line in silence_run.stderr.splitlines():
        started = re.search(r"silence_start: (-?[\d.]+)", line)
        ended = re.search(r"silence_end: (-?[\d.]+)", line)
        if started:
            opened = max(0.0, float(started.group(1)))
        elif ended and opened is not None:
            silences.append({"start": round(begin + opened, 2), "end": round(begin + float(ended.group(1)), 2)})
            opened = None
    if opened is not None:
        silences.append({"start": round(begin + opened, 2), "end": round(finish, 2)})
    return {
        "start": round(begin, 2),
        "end": round(finish, 2),
        "seconds_per_level": round(span / len(levels), 3),
        "levels_db": levels[:WAVEFORM_BUCKETS],
        "threshold_db": threshold_db,
        "silences": silences,
    }


def look(store: Any, request: dict[str, Any], root: Path) -> dict[str, Any]:
    """`{user_id, clip_id, op, input, document?, manifest?}` → `{images: [base64 JPEG], data}`.

    Errors Claude can act on come back as `{"error": sentence}`; anything else raises.
    """
    op = request.get("op")
    if op not in OPS:
        return {"error": f"Unknown look request: {op}."}
    user_id = str(request.get("user_id") or "")
    clip_id = str(request.get("clip_id") or "")
    params = request.get("input") or {}
    try:
        clip, job = _owned_clip(store, user_id, clip_id)
        if op in ("capture", "inspect_color", "frame"):
            spec = _document_job(store, request, clip, job, root)
            keep = {
                "capture": ("times", "start", "end", "count", "grid"),
                "inspect_color": ("time", "element_id"),
                "frame": ("time", "edge"),
            }[op]
            spec.update({"op": op, **{key: params[key] for key in keep if key in params}})
            if isinstance(spec.get("times"), list):
                spec["times"] = spec["times"][:MAX_TIMES]
            return _render(spec, root)
        sources = _sources(store, user_id, clip, job, request.get("manifest") or {}, root)
        path = params.get("path")
        # A library file is named by its path, as in the in-app tools; `_Sources` matches it.
        src = MASTER if (op == "waveform" and not path) else str(path or "")
        if not path and op == "grab":
            return {"error": "media_grab needs the library path of a video or image."}
        file = sources.media(src)
        if op == "grab":
            spec = {"op": "grab", "file": str(file), "document": {"version": 1, "stage": {"children": []}},
                    "media": [], "transcripts": [], "fonts": str(EDITOR_FONTS), "lottie": str(EDITOR_LOTTIE),
                    **{key: params[key] for key in ("times", "count") if key in params}}
            return _render(spec, root)
        data = waveform_of(
            file,
            params.get("start"),
            params.get("end"),
            float(params.get("threshold_db") if params.get("threshold_db") is not None else -35),
            float(params.get("min_silence") if params.get("min_silence") is not None else 0.4),
        )
        return {"images": [], "data": {"path": path or MASTER, **data}}
    except (LookError, SourceError) as exc:
        return {"error": str(exc)}


__all__ = ["CLIP_EXPORT", "LookError", "look", "waveform_of"]
