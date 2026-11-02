"""platforms.json is read the same way here as in the web app: ids, limits and the product rules."""

from __future__ import annotations

from opencmo import platforms


def test_six_profiles_with_unique_ids():
    ids = [p.id for p in platforms.profiles()]
    assert sorted(ids) == ["instagram_caption", "linkedin", "threads", "tiktok_caption", "x", "youtube"]


def test_posts_have_no_hashtags_and_nothing_has_links():
    for p in platforms.profiles():
        assert p.links is False
        if p.kind == "post":
            assert p.hashtags == 0


def test_limits_match_the_contract():
    assert platforms.profile("x").limit == 280
    assert platforms.profile("threads").limit == 500
    assert platforms.profile("linkedin").visible_before_more == 140
    assert platforms.profile("youtube").title == 100
    assert platforms.profile("reddit") is None
