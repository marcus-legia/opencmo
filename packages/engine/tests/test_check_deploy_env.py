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
    for feature in env.FEATURES:
        for entry in feature.keys:
            name = entry.split("|")[0]
            seen[VERCEL][name] = env.fingerprint(name, f"value of {name}")
        if feature.gate:
            seen[VERCEL][feature.gate[0]] = feature.gate[1]
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


def test_moderation_needs_the_anthropic_key_in_each_place():
    seen = _healthy()
    for place, key in [(p, k) for shared in env.SHARED if shared.what == "fal key" for p, k in shared.holders]:
        seen[place][key] = None
    problems, _ = env.check(seen)
    assert problems == [], "fal is optional"
    seen[WORKER]["ANTHROPIC_API_KEY"] = None
    problems, _ = env.check(seen)
    assert "opencmo: no moderation key (ANTHROPIC_API_KEY): AI media cannot be checked" in problems


def test_a_removed_provider_key_left_set_is_a_note():
    seen = _healthy()
    seen[WORKER]["GEMINI_API_KEY"] = env.fingerprint("GEMINI_API_KEY", "g")
    seen[VERCEL]["GROQ_API_KEY"] = env.fingerprint("GROQ_API_KEY", "q")
    problems, notes = env.check(seen)
    assert problems == []
    assert "opencmo:GEMINI_API_KEY is set but nothing reads it any more (Claude only): remove it" in notes
    assert any(note.startswith(f"{VERCEL}:GROQ_API_KEY is set") for note in notes)


def test_an_optional_key_set_somewhere_must_be_set_and_equal_everywhere():
    seen = _healthy()
    seen[MCP]["ANTHROPIC_API_KEY"] = None
    problems, _ = env.check(seen)
    assert "Anthropic key: opencmo-mcp:ANTHROPIC_API_KEY is not set" in problems


def test_the_look_token_must_match_and_its_url_name_the_look_endpoint():
    # The MCP server sends OPENCMO_LOOK_TOKEN to the worker's `look` endpoint, which checks it.
    seen = _healthy()
    seen[WORKER]["OPENCMO_LOOK_TOKEN"] = env.fingerprint("OPENCMO_LOOK_TOKEN", "other")
    seen[MCP]["OPENCMO_LOOK_URL"] = URLS["OPENCMO_WAKE_URL"]
    problems, _ = env.check(seen)
    assert any(problem.startswith("look token differs") for problem in problems)
    assert any("OPENCMO_LOOK_URL points at the wrong endpoint" in problem for problem in problems)


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



def test_creem_keys_on_different_modes_are_named():
    seen = _healthy()
    seen[WORKER]["CREEM_API_KEY"] = env.fingerprint("CREEM_API_KEY", "creem_test_abc")
    problems, _ = env.check(seen)
    assert "Creem key mode differs: vercel live, opencmo test" in problems
    assert "creem_test_abc" not in " ".join(problems)


def test_a_test_creem_key_on_vercel_production_is_a_problem():
    seen = _healthy()
    seen[VERCEL]["CREEM_API_KEY"] = seen[WORKER]["CREEM_API_KEY"] = env.fingerprint("CREEM_API_KEY", "creem_test_abc")
    problems, _ = env.check(seen)
    assert any(problem.startswith("vercel:CREEM_API_KEY is a test key") for problem in problems)
    assert not any(problem.startswith("Creem key mode differs") for problem in problems)


def test_a_hidden_creem_key_is_not_judged_on_its_mode():
    seen = _healthy()
    seen[VERCEL]["CREEM_API_KEY"] = ""
    problems, notes = env.check(seen)
    assert problems == []
    assert any("CREEM_API_KEY" in note for note in notes)


def test_posting_switched_on_without_zernio_keys_is_a_problem():
    seen = _healthy()
    seen[VERCEL]["ZERNIO_WEBHOOK_SECRET"] = None
    problems, _ = env.check(seen)
    assert problems == ["Zernio posting: OPENCMO_PUBLISH_LIVE=1 but ZERNIO_WEBHOOK_SECRET not set"]


def test_features_left_off_are_notes():
    seen = _healthy()
    for name in ("OPENCMO_PUBLISH_LIVE", "OPENCMO_EMAIL_LIVE", "SCRAPECREATORS_API_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"):
        seen[VERCEL][name] = None
    problems, notes = env.check(seen)
    assert problems == []
    assert "Zernio posting is off (OPENCMO_PUBLISH_LIVE is not 1)" in notes
    assert "Resend email is off (OPENCMO_EMAIL_LIVE is not 1)" in notes
    assert "ScrapeCreators (research, Sales scans) is off: set SCRAPECREATORS_API_KEY or SCRAPE_CREATORS_API_KEY on vercel" in notes
    assert any(note.startswith("Web push (VAPID) is off") for note in notes)


def test_the_other_scrapecreators_name_counts_and_half_a_vapid_pair_is_a_problem():
    seen = _healthy()
    seen[VERCEL]["SCRAPECREATORS_API_KEY"] = None
    seen[VERCEL]["SCRAPE_CREATORS_API_KEY"] = env.fingerprint("SCRAPE_CREATORS_API_KEY", "k")
    seen[VERCEL]["VAPID_PRIVATE_KEY"] = None
    problems, notes = env.check(seen)
    assert problems == ["Web push (VAPID) is half set up: VAPID_PRIVATE_KEY not set on vercel"]
    assert not any("ScrapeCreators" in note for note in notes)


def test_vercel_reads_the_feature_keys_and_their_gates():
    keys = env.keys_to_read(VERCEL)
    for name in ("ZERNIO_API_KEY", "OPENCMO_PUBLISH_LIVE", "RESEND_API_KEY", "VAPID_PRIVATE_KEY", "SCRAPE_CREATORS_API_KEY", "CREEM_WEBHOOK_SECRET"):
        assert name in keys
    assert "ZERNIO_API_KEY" not in env.keys_to_read(WORKER)
