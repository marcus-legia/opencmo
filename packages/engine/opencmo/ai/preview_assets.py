"""`python -m opencmo.ai.preview_assets <job.json> <out.json>`: the web app's local preview path
(`OPENCMO_MOTION=local`) prepares a job's images with the same encoder as a final render, then
runs `clip-motion preview` itself. On Modal, `PreviewSession.preview` does the same step.

Exit 0: `out.json` holds the job with data-URI images. Exit 3: stdout holds one PreviewResult line
(`{"ok": false, "phase": "job", "message": ...}`) naming the image the model should change.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from opencmo.ai.catalog import SpecError
from opencmo.ai.providers.motion import preview_assets


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write("usage: python -m opencmo.ai.preview_assets <job.json> <out.json>\n")
        return 2
    job = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="opencmo-preview-assets-") as tmp:
        try:
            prepared = preview_assets(job, Path(tmp))
        except SpecError as exc:
            print(json.dumps({"ok": False, "phase": "job", "message": str(exc)}))
            return 3
    Path(argv[1]).write_text(json.dumps(prepared), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
