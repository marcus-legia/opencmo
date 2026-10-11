"""Output moderation: fal's NSFW classifier plus Claude, both must pass; failures never pass."""

from __future__ import annotations

import sys
import types

import httpx
import pytest

from opencmo.ai import moderation
from opencmo.ai.catalog import get_model
from opencmo.ai.providers.base import ProviderError


@pytest.fixture
def image(tmp_path):
    path = tmp_path / "result.png"
    path.write_bytes(b"\x89PNG fake")
    return path


@pytest.fixture(autouse=True)
def keys(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "fal")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "claude")


def _nsfw(monkeypatch, status=200, flags=(False,), raises=False):
    seen = {}

    def post(url, **kwargs):
        seen.update(url=url, **kwargs)
        if raises:
            raise httpx.ConnectError("down")
        return httpx.Response(status, json={"has_nsfw_concepts": list(flags)}, request=httpx.Request("POST", url))

    monkeypatch.setattr(moderation.httpx, "post", post)
    return seen


def _claude(monkeypatch, allowed=True, stop="end_turn", error=None, verdict=True):
    seen = {}

    class APIStatusError(Exception):
        status_code = 400

    class RateLimitError(Exception):
        pass

    class Messages:
        def parse(self, **kwargs):
            seen.update(kwargs)
            if error:
                raise error(RateLimitError, APIStatusError)
            parsed = moderation._Verdict(allowed=allowed, category="none" if allowed else "real_person") if verdict else None
            return types.SimpleNamespace(stop_reason=stop, parsed_output=parsed)

    class Anthropic:
        def __init__(self, **_kwargs):
            self.messages = Messages()

    fake = types.SimpleNamespace(
        Anthropic=Anthropic,
        APIConnectionError=type("APIConnectionError", (Exception,), {}),
        RateLimitError=RateLimitError,
        InternalServerError=type("InternalServerError", (Exception,), {}),
        APIStatusError=APIStatusError,
    )
    monkeypatch.setitem(sys.modules, "anthropic", fake)
    return seen


def test_clean_image_passes_both_checks(monkeypatch, image):
    nsfw = _nsfw(monkeypatch)
    claude = _claude(monkeypatch)
    moderation.check_output(get_model("fal-nano-banana"), {"prompt": "a laptop"}, image)
    assert nsfw["url"] == moderation.NSFW_ENDPOINT
    assert nsfw["headers"] == {"Authorization": "Key fal"}
    assert nsfw["json"]["image_urls"][0].startswith("data:image/png;base64,")
    assert claude["system"] == moderation.POLICY
    assert claude["output_config"] == {"effort": "low"}
    assert claude["messages"][0]["content"][0]["type"] == "image"


def test_cutout_of_the_users_own_footage_does_not_block_a_recognisable_person(monkeypatch, image):
    _nsfw(monkeypatch)
    claude = _claude(monkeypatch)
    monkeypatch.setattr(moderation, "_frames", lambda _path, _workdir: [image])
    moderation.check_output(get_model("fal-veed-cutout"), {"prompt": "a beach"}, image)
    assert claude["system"] == moderation.OWN_FOOTAGE_POLICY
    assert "real person" not in claude["system"] and "logo" in claude["system"]
    assert "real person" in moderation.POLICY


def test_a_verdict_cut_off_by_max_tokens_is_retried_not_blocked(monkeypatch, image):
    _nsfw(monkeypatch)
    _claude(monkeypatch, stop="max_tokens", verdict=False)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert err.value.retryable


@pytest.mark.parametrize("flags", [(True,), (), (False, False)])
def test_nsfw_flag_or_wrong_shape_blocks(monkeypatch, image, flags):
    _nsfw(monkeypatch, flags=flags)
    _claude(monkeypatch)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert not err.value.retryable


def test_claude_block_or_refusal_blocks(monkeypatch, image):
    _nsfw(monkeypatch)
    _claude(monkeypatch, allowed=False)
    with pytest.raises(ProviderError, match="content policy"):
        moderation.check_images([image])
    _claude(monkeypatch, stop="refusal")
    with pytest.raises(ProviderError, match="content policy"):
        moderation.check_images([image])


def test_unreachable_checks_are_retryable_not_passed(monkeypatch, image):
    _nsfw(monkeypatch, raises=True)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert err.value.retryable

    _nsfw(monkeypatch)
    _claude(monkeypatch, error=lambda rate, _status: rate("slow down"))
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert err.value.retryable


def test_client_error_from_a_check_blocks(monkeypatch, image):
    _nsfw(monkeypatch, status=422)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert not err.value.retryable


def test_skipped_without_keys(monkeypatch, image):
    monkeypatch.delenv("FAL_KEY")
    monkeypatch.setattr(moderation.httpx, "post", lambda *_a, **_k: pytest.fail("no call without keys"))
    moderation.check_output(get_model("fal-nano-banana"), {"prompt": "x"}, image)
    assert not moderation.ready()


def test_real_fal_nsfw_response_passes_a_clean_image(monkeypatch, tmp_path):
    """`fixtures/live/fal-nsfw.json` is the real answer for one clean image, 2026-10-11."""
    import json
    from pathlib import Path

    body = json.loads((Path(__file__).parent / "fixtures" / "live" / "fal-nsfw.json").read_text())
    assert body == {"has_nsfw_concepts": [False]}
    _nsfw(monkeypatch, flags=tuple(body["has_nsfw_concepts"]))
    image = tmp_path / "a.png"
    image.write_bytes(b"png")
    moderation._check_nsfw([image])


def test_busy_output_check_retries_in_place_then_fails_for_good(monkeypatch, tmp_path):
    """The media is already paid for: a busy check must not make the worker generate it again."""
    calls = {"n": 0}

    def busy_then_clean(*_a):
        calls["n"] += 1
        if calls["n"] < 3:
            raise ProviderError(moderation.UNCHECKED, retryable=True)

    waits: list[float] = []
    monkeypatch.setattr(moderation, "_sleep", waits.append)
    monkeypatch.setattr(moderation, "check_images", busy_then_clean)
    monkeypatch.setattr(moderation, "ready", lambda: True)
    image = tmp_path / "a.png"
    image.write_bytes(b"png")
    model = get_model("fal-nano-banana")
    moderation.check_output(model, {"prompt": "x"}, image)
    assert calls["n"] == 3 and waits == [2.0, 5.0]

    monkeypatch.setattr(moderation, "check_images", lambda *_a: (_ for _ in ()).throw(ProviderError(moderation.UNCHECKED, retryable=True)))
    with pytest.raises(ProviderError) as info:
        moderation.check_output(model, {"prompt": "x"}, image)
    assert info.value.retryable is False
