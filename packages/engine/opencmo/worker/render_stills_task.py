"""`render_stills` (P5): one PNG per slide of a slideshow, drawn by the export renderer.

Placeholder from A0 so the kind list, the SQL CHECK and an importable handler change together
(`test_task_kinds.py`, `task-kinds.check.ts`). Session B (B2) replaces the body with the real still export
built on `clip-export/src/look.ts`; until then a queued task fails with a clear message instead of hanging.
"""

from __future__ import annotations

from typing import Any

from opencmo.backends.supabase import Task
from opencmo.worker.task_run import TaskContext, TaskError, run_task

FAILED = "Exporting the slides as images failed. Please retry."
NOT_READY = "Exporting slides as images is not available yet."


def process(store: Any, task: Task) -> None:
    def body(ctx: TaskContext) -> None:
        raise TaskError(NOT_READY)

    run_task(store, task, name="render-stills", failed=FAILED, body=body)
