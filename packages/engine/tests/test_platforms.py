"""platforms.json is read the same way here as in the web app: ids, limits and the product rules."""

from __future__ import annotations

from opencmo import platforms


def test_eight_profiles_with_unique_ids():
    ids = [p.id for p in platforms.profiles()]
    assert sorted(ids) == ["core", "facebook", "instagram_caption", "linkedin", "threads", "tiktok_caption", "x", "youtube"]


def test_only_the_core_post_names_no_platform():
    for p in platforms.profiles():
        assert (p.platform is None) == (p.kind == "core"), p.id


def test_posts_have_no_hashtags_and_nothing_has_links():
    for p in platforms.profiles():
        assert p.links is False
        if p.kind in ("post", "core"):
            assert p.hashtags == 0


def test_limits_match_the_contract():
    assert platforms.profile("x").limit == 4000  # long posts (D6), held at 4,000 (F4, 2026-11-13)
    assert platforms.profile("threads").limit == 500
    assert platforms.profile("linkedin").visible_before_more == 140
    assert platforms.profile("youtube").title == 100
    assert platforms.profile("reddit") is None
