"""`look_check` (P6 S4): look at a finished export before its card is raised.

Contract (P6 B0; the TS side is `apps/web/lib/departments/studio/look-check.ts`, keep both in step):

Input, `tasks.settings`, written by the SQL rules when a Studio render is done:
    {"ref_kind": "editor_project" | "short_batch" | "studio_step", "ref_id": uuid, "round": 0 | 1,
     "files": [{"path": "<user>/<clip>/<task>.mp4", "clip_id": uuid}, ...]}

Output, `tasks.output`:
    {"pass": bool, "round": 0 | 1, "note": str (<= 200, English, empty on a pass),
     "files": [{"path", "clip_id", "pass", "answers": [{"id", "pass": bool | None, "why", "at"?}],
                "frame_times": [float, ...]}]}

Rules:
- Reads only the full-size export in the `exports` bucket, never `*.preview.mp4`, with its format stated
  (it is our own output, but still not sniffed).
- Black, frozen and silence are found by ffmpeg filters streaming over the file: no model, no frames in
  Python memory. At most `MAX_FRAMES` stills are drawn (`-ss` before `-i`, one ffmpeg each, capped in
  parallel); they go through moderation, then the vision judge answers the two picture questions.
- No vision key or a judge error answers `None` (not checked), never a fail.
- Nothing is spent and nothing is uploaded: the stills live in a temp dir for the task only.
"""

from __future__ import annotations

#: Same cap as `look.py` `MAX_TIMES`.
MAX_FRAMES = 12

#: (id, by) — ids shared with `LOOK_QUESTIONS` in `look-check.ts`.
QUESTIONS: tuple[tuple[str, str], ...] = (
    ("no_black_frames", "code"),
    ("no_frozen_frames", "code"),
    ("sound_present", "code"),
    ("captions_inside", "judge"),
    ("text_readable", "judge"),
)

REF_KINDS = ("editor_project", "short_batch", "studio_step")
