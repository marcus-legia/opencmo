"""Rules of check_deploy_env.py (opencmo/deploy_env.py), on made-up fingerprints."""

from __future__ import annotations

import copy

from opencmo import deploy_env as env
from opencmo.deploy_env import MCP, MOTION, VERCEL, WORKER

MCP_URL = "https://ws--opencmo-mcp.us-east.modal.run/mcp"
URLS = {
    "OPENCMO_WAKE_URL": "https://ws--opencmo-wake.us-east.modal.run",
    "OPENCMO_LOOK_URL": "https://ws--opencmo-look.us-east.modal.run",
    "MOTION_PREVIEW_URL": "https://ws--opencmo-motion-preview.us-east.modal.run",
}


def _healthy() -> dict[str, dict[str, str | None]]:
    """Every place holding what the rules expect: the check finds nothing."""
    seen: dict[str, dict[str, str | None]] = {place: {} for place in env.PLACES}
    for shared in env.SHARED:
        value = env.fingerprint(shared.holders[0][1], f"value of {shared.what}")
        if shared.what == "MCP URL":
            value = MCP_URL
        if shared.holders[0][1] in URLS:
            value = URLS[shared.holders[0][1]]
        for place, key in shared.holders:
            seen[place][key] = value
    for key in env.MCP_REQUIRED:
        seen[MCP].setdefault(key, URLS.get(key) or env.fingerprint(key, f"value of {key}"))
    for place, key, expected in env.EXPECTED:
        seen[place][key] = expected
    # Groq, the default endpoint: no compat URL or vision model named.
    for shared in env.SHARED:
        if shared.what in ("OpenAI-compatible endpoint", "moderation vision model"):
            for place, key in shared.holders:
                seen[place][key] = None
    return seen


def test_a_healthy_deploy_has_no_problems():
    problems, notes = env.check(_healthy())
    assert problems == []
    assert notes == []


def test_a_token_changed_on_one_side_only_is_reported():
    # The 2026-10-19 outage: Vercel kept the old explainer preview token.
    seen = _healthy()
    seen[VERCEL]["MOTION_PREVIEW_TOKEN"] = env.fingerprint("MOTION_PREVIEW_TOKEN", "old")
    problems, _ = env.check(seen)
    assert any(problem.startswith("explainer preview token differs") for problem in problems)


def test_the_report_never_contains_a_secret_value():
    seen = _healthy()
    seen[VERCEL]["MOTION_PREVIEW_TOKEN"] = env.fingerprint("MOTION_PREVIEW_TOKEN", "super-secret-old")
    problems, _ = env.check(seen)
    assert "super-secret" not in " ".join(problems)


def test_an_mcp_url_without_the_mcp_path_is_reported():
    seen = _healthy()
    seen[VERCEL]["OPENCMO_MCP_URL"] = seen[MCP]["OPENCMO_MCP_URL"] = "https://ws--opencmo-mcp.us-east.modal.run"
    problems, _ = env.check(seen)
    assert sum("must end in /mcp" in problem for problem in problems) == 2


def test_missing_mcp_keys_and_wrong_flags_are_reported():
    seen = _healthy()
    del seen[MCP]["OPENCMO_MOTION"]
    seen[MCP]["OPENCMO_ENV"] = "development"
    problems, _ = env.check(seen)
    assert "opencmo-mcp:OPENCMO_MOTION is missing (the MCP server needs it)" in problems
    assert "opencmo-mcp:OPENCMO_ENV is 'development', expected 'production'" in problems


def test_worker_secrets_in_the_mcp_container_are_reported():
    seen = _healthy()
    seen[MCP]["OPENCMO_WORKER_TOKEN"] = seen[WORKER]["OPENCMO_WORKER_TOKEN"]
    seen[MOTION]["SUPABASE_SERVICE_ROLE_KEY"] = "sha256:abc"
    problems, _ = env.check(seen)
    assert any(problem.startswith("opencmo-mcp:OPENCMO_WORKER_TOKEN must not be there") for problem in problems)
    assert any(problem.startswith("opencmo-motion:SUPABASE_SERVICE_ROLE_KEY must not be there") for problem in problems)


def test_whitespace_around_a_token_is_reported():
    seen = _healthy()
    seen[WORKER]["OPENCMO_WAKE_TOKEN"] = env.fingerprint("OPENCMO_WAKE_TOKEN", "value of wake token\n")
    problems, _ = env.check(seen)
    assert "wake token: opencmo:OPENCMO_WAKE_TOKEN has surrounding whitespace" in problems


def test_an_unreadable_vercel_value_is_a_note_not_a_problem():
    seen = _healthy()
    seen[VERCEL]["SUPABASE_JWT_SECRET"] = ""
    problems, notes = env.check(seen)
    assert problems == []
    assert len(notes) == 1 and notes[0].endswith(": SUPABASE_JWT_SECRET")


def test_places_not_read_are_noted_and_not_judged():
    seen = copy.deepcopy(_healthy())
    del seen[VERCEL]
    problems, notes = env.check(seen)
    assert problems == []
    assert notes == ["not read: vercel"]


def test_plain_keys_stay_readable_and_secrets_are_hashed():
    assert env.fingerprint("OPENCMO_MCP_URL", MCP_URL) == MCP_URL
    assert env.fingerprint("OPENCMO_WAKE_TOKEN", "abc").startswith("sha256:")
    assert env.fingerprint("OPENCMO_WAKE_TOKEN", None) is None


def test_parse_dotenv_reads_vercel_pull_output():
    text = '# Created by Vercel CLI\nOPENCMO_ENV="production"\nMOTION_PREVIEW_TOKEN="a\\"b"\nEMPTY=""\n'
    assert env.parse_dotenv(text) == {"OPENCMO_ENV": "production", "MOTION_PREVIEW_TOKEN": 'a"b', "EMPTY": ""}


def test_a_url_pasted_on_the_wrong_line_is_reported():
    # 2026-10-19: OPENCMO_WAKE_URL held the motion preview URL, so every wake got 401.
    seen = _healthy()
    seen[MCP]["OPENCMO_WAKE_URL"] = URLS["MOTION_PREVIEW_URL"]
    problems, _ = env.check(seen)
    assert problems == [
        f"opencmo-mcp:OPENCMO_WAKE_URL points at the wrong endpoint (expected a URL with '--opencmo-wake.', got {URLS['MOTION_PREVIEW_URL']})"
    ]


def test_moderation_needs_one_provider_key_per_place_not_anthropic_or_fal():
    seen = _healthy()
    for place, key in [(p, k) for shared in env.SHARED if shared.what in ("Anthropic key", "fal key") for p, k in shared.holders]:
        seen[place][key] = None
    problems, _ = env.check(seen)
    assert problems == [], "Groq alone is enough"
    for key in env.MODERATION_KEYS:
        seen[WORKER][key] = None
    problems, _ = env.check(seen)
    assert problems and all("opencmo: no moderation key" in problem or "Groq key" in problem for problem in problems)


def test_the_worker_must_be_able_to_check_frames_on_another_endpoint():
    seen = _healthy()
    for place, key in [(p, k) for shared in env.SHARED if shared.what == "Anthropic key" for p, k in shared.holders]:
        seen[place][key] = None
    for place in (VERCEL, WORKER, MCP):
        seen[place]["OPENAI_COMPAT_BASE_URL"] = "https://openrouter.ai/api/v1"
        seen[place]["OPENAI_COMPAT_API_KEY"] = env.fingerprint("OPENAI_COMPAT_API_KEY", "sk")
    problems, _ = env.check(seen)
    assert any("moderation cannot check images" in problem for problem in problems), problems
    for place in (VERCEL, WORKER, MCP):
        seen[place]["OPENCMO_MODERATION_VISION_MODEL"] = "vendor/vision"
    problems, _ = env.check(seen)
    assert problems == [], problems


def test_an_optional_key_set_somewhere_must_be_set_and_equal_everywhere():
    seen = _healthy()
    seen[MCP]["GROQ_API_KEY"] = None
    problems, _ = env.check(seen)
    assert "Groq key: opencmo-mcp:GROQ_API_KEY is not set" in problems


def test_the_look_token_must_match_and_its_url_name_the_look_endpoint():
    # The MCP server sends OPENCMO_LOOK_TOKEN to the worker's `look` endpoint, which checks it.
    seen = _healthy()
    seen[WORKER]["OPENCMO_LOOK_TOKEN"] = env.fingerprint("OPENCMO_LOOK_TOKEN", "other")
    seen[MCP]["OPENCMO_LOOK_URL"] = URLS["OPENCMO_WAKE_URL"]
    problems, _ = env.check(seen)
    assert any(problem.startswith("look token differs") for problem in problems)
    assert any("OPENCMO_LOOK_URL points at the wrong endpoint" in problem for problem in problems)


def test_the_groq_url_is_the_moderation_one():
    from opencmo.ai import moderation

    assert env.GROQ_BASE_URL == moderation.GROQ_BASE_URL


def test_motion_asset_origin_must_equal_the_worker_supabase_url():
    # Previews fetch the user's images from signed URLs of this project, and only from it.
    seen = _healthy()
    assert seen[MOTION]["OPENCMO_MOTION_ASSET_ORIGIN"] == seen[WORKER]["SUPABASE_URL"]
    seen[MOTION]["OPENCMO_MOTION_ASSET_ORIGIN"] = "https://other.supabase.co"
    problems, _ = env.check(seen)
    assert any(problem.startswith("Supabase URL differs") and "opencmo-motion:OPENCMO_MOTION_ASSET_ORIGIN=https://other.supabase.co" in problem for problem in problems)
    seen[MOTION]["OPENCMO_MOTION_ASSET_ORIGIN"] = None
    problems, _ = env.check(seen)
    assert "Supabase URL: opencmo-motion:OPENCMO_MOTION_ASSET_ORIGIN is not set" in problems
    assert env.fingerprint("OPENCMO_MOTION_ASSET_ORIGIN", "https://x.supabase.co") == "https://x.supabase.co"

