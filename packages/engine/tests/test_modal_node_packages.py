"""The worker image installs only a few workspaces, so none of them may name another one it leaves out.

npm resolves a workspace's devDependencies even with `--omit=dev`, and an `@opencmo/*` package is not on the
registry: one devDependency on a package left out of the image fails the whole `modal deploy` with E404.
"""

import json
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
SECTIONS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")


def test_image_workspaces_name_only_each_other():
    workspaces = json.loads((ENGINE / "clip_export_package.json").read_text())["workspaces"]
    packages = [json.loads((ENGINE.parent.parent / w / "package.json").read_text()) for w in workspaces]
    names = {p["name"] for p in packages}
    for package in packages:
        for section in SECTIONS:
            for dep in package.get(section, {}):
                if dep.startswith("@opencmo/"):
                    assert dep in names, f"{package['name']} {section} names {dep}, which the image leaves out"
