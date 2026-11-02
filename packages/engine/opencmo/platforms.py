"""Platform profiles: `packages/contracts/platforms.json` (writer.md §7).

The web app's Writer, code checks and cards read the same file (`apps/web/lib/cmo/platforms.ts`), and SQL's
`platform_profile()` carries the same numbers; check:contracts compares them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

# Dev machine: packages/engine/opencmo/platforms.py → packages/contracts. Modal: modal_app.py copies it to /root/contracts.
_CANDIDATES = (
    Path(__file__).resolve().parents[2] / "contracts" / "platforms.json",
    Path("/root/contracts/platforms.json"),
)


@dataclass(frozen=True)
class PlatformProfile:
    id: str
    label: str
    platform: str
    kind: str
    limit: int
    title: int | None
    visible_before_more: int | None
    hashtags: int
    links: bool
    tone: str


def _path() -> Path:
    for candidate in _CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("packages/contracts/platforms.json not found")


@lru_cache(maxsize=1)
def profiles() -> tuple[PlatformProfile, ...]:
    data = json.loads(_path().read_text(encoding="utf-8"))
    return tuple(
        PlatformProfile(
            id=str(p["id"]),
            label=str(p["label"]),
            platform=str(p["platform"]),
            kind=str(p["kind"]),
            limit=int(p["limit"]),
            title=None if p["title"] is None else int(p["title"]),
            visible_before_more=None if p["visibleBeforeMore"] is None else int(p["visibleBeforeMore"]),
            hashtags=int(p["hashtags"]),
            links=bool(p["links"]),
            tone=str(p["tone"]),
        )
        for p in data["profiles"]
    )


def profile(profile_id: str) -> PlatformProfile | None:
    """The profile with this id, or None for a platform without one."""
    return next((p for p in profiles() if p.id == profile_id), None)
