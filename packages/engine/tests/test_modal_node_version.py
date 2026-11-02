"""The worker and the MCP server build their images with the same Node.js (review follow-up L4).

Each deploy file keeps its own constant, because Modal imports the file alone inside the container; this test is
what keeps the two in step.
"""

import re
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent


def _node_version(name: str) -> str:
    match = re.search(r'^NODE_VERSION = "([0-9.]+)"$', (ENGINE / name).read_text(), re.MULTILINE)
    assert match, name
    return match.group(1)


def test_worker_and_mcp_images_use_one_node_version():
    assert _node_version("modal_app.py") == _node_version("mcp_app.py")
