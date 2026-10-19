"""Do the deploy's secrets agree? Rules and checks for `check_deploy_env.py`.

One deploy spreads its configuration over Vercel and five Modal secrets, and a value shared by two
of them (a token one side sends and the other checks) breaks silently when only one side changes:
the 2026-10-19 explainer outage was Vercel still sending an old `MOTION_PREVIEW_TOKEN` (a pair
this cannot compare: Vercel hides Sensitive values, see check_deploy_env.py). These
checks see only fingerprints of secret values, plus the plain value of a few keys that are not
secret (URLs, flags), so the report can be printed and pasted anywhere.

Pure functions, no Modal or Vercel here: `check_deploy_env.py` collects, this module judges.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

VERCEL = "vercel"
WORKER = "opencmo"
VOICE = "opencmo-voice"
FAL = "fal-secret"
MOTION = "opencmo-motion"
MCP = "opencmo-mcp"

MODAL_SECRETS = (WORKER, VOICE, FAL, MOTION, MCP)
PLACES = (VERCEL, *MODAL_SECRETS)

# Not secret: shown as is, so a wrong URL or flag is visible in the report.
PLAIN_KEYS = frozenset(
    {
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_URL",
        "OPENCMO_MCP_URL",
        "OPENCMO_WEB_URL",
        "OPENCMO_WAKE_URL",
        "MOTION_PREVIEW_URL",
        "OPENCMO_ENV",
        "OPENCMO_MOTION",
        "OPENCMO_VOICE_ENABLED",
    }
)


@dataclass(frozen=True)
class Shared:
    """One value that several places must hold identically, maybe under different names."""

    what: str
    holders: tuple[tuple[str, str], ...]  # (place, key)


SHARED = (
    Shared("explainer preview token", ((VERCEL, "MOTION_PREVIEW_TOKEN"), (MOTION, "MOTION_PREVIEW_TOKEN"), (MCP, "MOTION_PREVIEW_TOKEN"))),
    Shared("explainer preview URL", ((VERCEL, "MOTION_PREVIEW_URL"), (MCP, "MOTION_PREVIEW_URL"))),
    Shared("wake token", ((WORKER, "OPENCMO_WAKE_TOKEN"), (MCP, "OPENCMO_WAKE_TOKEN"))),
    Shared("worker token", ((VERCEL, "OPENCMO_WORKER_TOKEN"), (WORKER, "OPENCMO_WORKER_TOKEN"))),
    Shared("CMO cron secret", ((VERCEL, "CRON_SECRET"), (WORKER, "CRON_SECRET"))),
    Shared("cleanup cron secret", ((VERCEL, "CRON_CLEANUP_SECRET"), (WORKER, "CRON_CLEANUP_SECRET"))),
    Shared("MCP URL", ((VERCEL, "OPENCMO_MCP_URL"), (MCP, "OPENCMO_MCP_URL"))),
    Shared("Supabase URL", ((VERCEL, "NEXT_PUBLIC_SUPABASE_URL"), (WORKER, "SUPABASE_URL"), (MCP, "NEXT_PUBLIC_SUPABASE_URL"))),
    Shared("Supabase anon key", ((VERCEL, "NEXT_PUBLIC_SUPABASE_ANON_KEY"), (MCP, "NEXT_PUBLIC_SUPABASE_ANON_KEY"))),
    Shared("Supabase service role key", ((VERCEL, "SUPABASE_SERVICE_ROLE_KEY"), (WORKER, "SUPABASE_SERVICE_ROLE_KEY"), (MCP, "SUPABASE_SERVICE_ROLE_KEY"))),
    Shared("Supabase JWT secret", ((VERCEL, "SUPABASE_JWT_SECRET"), (MCP, "SUPABASE_JWT_SECRET"))),
    Shared("Anthropic key", ((VERCEL, "ANTHROPIC_API_KEY"), (WORKER, "ANTHROPIC_API_KEY"), (MCP, "ANTHROPIC_API_KEY"))),
    Shared("fal key", ((VERCEL, "FAL_KEY"), (FAL, "FAL_KEY"), (MCP, "FAL_KEY"))),
    Shared("ElevenLabs key", ((VERCEL, "ELEVENLABS_API_KEY"), (VOICE, "ELEVENLABS_API_KEY"))),
)

# The MCP server reads apps/web/lib with no VERCEL_ENV: everything Vercel has implicitly or by its
# own variable must be spelled out here (mcp_app.py lists them).
MCP_REQUIRED = (
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "FAL_KEY",
    "MOTION_PREVIEW_URL",
    "MOTION_PREVIEW_TOKEN",
    "OPENCMO_MCP_URL",
    "OPENCMO_WEB_URL",
    "OPENCMO_MCP_CONFIRM_KEY",
    "OPENCMO_WAKE_URL",
    "OPENCMO_WAKE_TOKEN",
    "OPENCMO_VOICE_ENABLED",
    "OPENCMO_MOTION",
    "OPENCMO_ENV",
)

# The containers that face the internet or run model-written code must not hold these (#74).
FORBIDDEN = (
    (MCP, ("OPENCMO_WORKER_TOKEN", "CRON_SECRET", "CRON_CLEANUP_SECRET", "ELEVENLABS_API_KEY", "MODAL_SUBMIT_URL")),
    (MOTION, ("OPENCMO_WORKER_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "ANTHROPIC_API_KEY")),
)

# Plain values that must be exactly this.
EXPECTED = (
    (MCP, "OPENCMO_ENV", "production"),
    (MCP, "OPENCMO_MOTION", "modal"),
    (MCP, "OPENCMO_VOICE_ENABLED", "1"),
    (VERCEL, "OPENCMO_MOTION", "modal"),
)

# A client connected to any other path ignores the server's OAuth metadata and cannot sign in.
MCP_URL_HOLDERS = ((VERCEL, "OPENCMO_MCP_URL"), (MCP, "OPENCMO_MCP_URL"))


def keys_to_read(place: str) -> list[str]:
    """Every key the checks look at in `place`."""
    keys = {key for shared in SHARED for holder, key in shared.holders if holder == place}
    keys |= {key for holder, key, _ in EXPECTED if holder == place}
    if place == MCP:
        keys |= set(MCP_REQUIRED)
    for holder, forbidden in FORBIDDEN:
        if holder == place:
            keys |= set(forbidden)
    return sorted(keys)


def fingerprint(key: str, value: str | None) -> str | None:
    """What leaves the container: None (unset), the plain value for PLAIN_KEYS, else a hash.

    Whitespace is flagged, not stripped: a pasted newline makes a token differ.
    """
    if value is None:
        return None
    if value == "":
        return ""
    if key in PLAIN_KEYS:
        return value
    digest = "sha256:" + hashlib.sha256(value.encode()).hexdigest()[:12]
    return digest + (" (surrounding whitespace)" if value != value.strip() else "")


def check(seen: dict[str, dict[str, str | None]]) -> tuple[list[str], list[str]]:
    """`seen[place][key]` is a fingerprint; a place absent from `seen` was not read.

    Returns (problems, notes): problems break something in production, notes are worth a look.
    """
    problems: list[str] = []
    notes: list[str] = []
    unreadable: list[str] = []

    def get(place: str, key: str) -> str | None:
        return seen.get(place, {}).get(key)

    for shared in SHARED:
        values: dict[str, str] = {}
        for place, key in shared.holders:
            if place not in seen:
                continue
            value = get(place, key)
            label = f"{place}:{key}"
            if value is None:
                problems.append(f"{shared.what}: {label} is not set")
            elif value == "":
                # The CLI pulls Sensitive variables empty: unreadable, not wrong. Listed once below.
                if place == VERCEL:
                    unreadable.append(key)
                else:
                    problems.append(f"{shared.what}: {label} is empty")
            elif "whitespace" in value:
                problems.append(f"{shared.what}: {label} has surrounding whitespace")
                values[label] = value
            else:
                values[label] = value
        if len(set(values.values())) > 1:
            listed = ", ".join(f"{label}={value}" for label, value in values.items())
            problems.append(f"{shared.what} differs: {listed}")

    if MCP in seen:
        for key in MCP_REQUIRED:
            if not get(MCP, key):
                problems.append(f"{MCP}:{key} is missing (the MCP server needs it)")

    for place, forbidden in FORBIDDEN:
        if place in seen:
            for key in forbidden:
                if get(place, key) is not None:
                    problems.append(f"{place}:{key} must not be there (that container must not hold it)")

    for place, key, expected in EXPECTED:
        value = get(place, key)
        if place in seen and value and value != expected:
            problems.append(f"{place}:{key} is {value!r}, expected {expected!r}")

    for place, key in MCP_URL_HOLDERS:
        value = get(place, key)
        if place in seen and value and not value.rstrip("/").endswith("/mcp"):
            problems.append(f"{place}:{key} must end in /mcp (got {value})")

    if unreadable:
        notes.append(
            "Vercel hides Sensitive values from the CLI, so these were not compared; after changing one, "
            "set the same value on both sides by hand: " + ", ".join(unreadable)
        )
    missing = [place for place in PLACES if place not in seen]
    if missing:
        notes.append("not read: " + ", ".join(missing))
    return problems, notes


def parse_dotenv(text: str) -> dict[str, str]:
    """`vercel env pull` output: KEY="value" lines, values JSON-quoted."""
    import json

    values: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, raw = line.partition("=")
        raw = raw.strip()
        if len(raw) >= 2 and raw[0] == raw[-1] == '"':
            try:
                raw = json.loads(raw)
            except ValueError:
                raw = raw[1:-1]
        values[key.strip()] = raw
    return values
