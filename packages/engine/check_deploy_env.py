"""Check that Vercel and the Modal secrets agree before (and after) a deploy.

    cd packages/engine && .venv312/bin/modal run check_deploy_env.py
    .venv312/bin/modal run check_deploy_env.py --skip-vercel   # Modal secrets only

Reads every Modal secret the deploy uses inside a tiny container, and Vercel's production
variables through `vercel env pull` into a temporary file deleted right after. Only fingerprints
of secret values leave either side (opencmo/deploy_env.py); the report is safe to paste. Exits 1
when something would break production. The rules live in opencmo/deploy_env.py.

Limit: Vercel's Sensitive variables come back empty from `vercel env pull`, so a secret Vercel
shares with Modal (the explainer preview token, the worker token, the cron secrets) is only
compared between the Modal secrets. Plain values on Vercel (URLs, flags) are checked.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import modal

from opencmo import deploy_env

app = modal.App("opencmo-env-check")
image = modal.Image.debian_slim(python_version="3.12").add_local_python_source("opencmo.deploy_env", copy=False)

REPO = Path(__file__).resolve().parent.parent.parent


def _read(place: str) -> dict[str, str | None]:
    from opencmo import deploy_env as rules

    return {key: rules.fingerprint(key, os.environ.get(key)) for key in rules.keys_to_read(place)}


# One function per secret: mounting them together would merge their keys and hide which one
# holds what.
@app.function(image=image, secrets=[modal.Secret.from_name(deploy_env.WORKER)], timeout=30)
def read_worker() -> dict[str, str | None]:
    return _read(deploy_env.WORKER)


@app.function(image=image, secrets=[modal.Secret.from_name(deploy_env.VOICE)], timeout=30)
def read_voice() -> dict[str, str | None]:
    return _read(deploy_env.VOICE)


@app.function(image=image, secrets=[modal.Secret.from_name(deploy_env.FAL)], timeout=30)
def read_fal() -> dict[str, str | None]:
    return _read(deploy_env.FAL)


@app.function(image=image, secrets=[modal.Secret.from_name(deploy_env.MOTION)], timeout=30)
def read_motion() -> dict[str, str | None]:
    return _read(deploy_env.MOTION)


@app.function(image=image, secrets=[modal.Secret.from_name(deploy_env.MCP)], timeout=30)
def read_mcp() -> dict[str, str | None]:
    return _read(deploy_env.MCP)


def _read_vercel() -> dict[str, str | None]:
    """Production variables, fingerprinted. The pulled file never outlives this function."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "vercel.env"
        subprocess.run(
            ["vercel", "env", "pull", str(path), "--environment=production", "--yes"],
            cwd=REPO,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        values = deploy_env.parse_dotenv(path.read_text(encoding="utf-8"))
    return {key: deploy_env.fingerprint(key, values.get(key)) for key in deploy_env.keys_to_read(deploy_env.VERCEL)}


@app.local_entrypoint()
def main(skip_vercel: bool = False) -> None:
    readers = {
        deploy_env.WORKER: read_worker,
        deploy_env.VOICE: read_voice,
        deploy_env.FAL: read_fal,
        deploy_env.MOTION: read_motion,
        deploy_env.MCP: read_mcp,
    }
    seen: dict[str, dict[str, str | None]] = {}
    for place, reader in readers.items():
        seen[place] = reader.remote()
    if not skip_vercel:
        try:
            seen[deploy_env.VERCEL] = _read_vercel()
        except (OSError, subprocess.CalledProcessError) as err:
            detail = getattr(err, "stderr", b"") or b""
            print(f"Could not read Vercel ({err}). {detail.decode(errors='replace').strip()}")

    problems, notes = deploy_env.check(seen)
    for note in notes:
        print(f"note: {note}")
    for problem in problems:
        print(f"PROBLEM: {problem}")
    if problems:
        print(f"{len(problems)} problem(s). Fix them before deploying.")
        sys.exit(1)
    print("Deploy env OK.")
