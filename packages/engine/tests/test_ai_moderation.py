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


def test_claude_block_or_refusal_blocks(monkeypatch, image, caplog):
    _nsfw(monkeypatch)
    _claude(monkeypatch, allowed=False)
    with caplog.at_level("WARNING", logger=moderation.log.name), pytest.raises(ProviderError, match="content policy"):
        moderation.check_images([image])
    assert "policy check" in caplog.text and "real_person" in caplog.text, "the log says why"
    _claude(monkeypatch, stop="refusal")
    with pytest.raises(ProviderError, match="content policy"):
        moderation.check_images([image])


def test_nsfw_block_is_logged(monkeypatch, image, caplog):
    _nsfw(monkeypatch, flags=(True,))
    _claude(monkeypatch)
    with caplog.at_level("WARNING", logger=moderation.log.name), pytest.raises(ProviderError):
        moderation.check_images([image])
    assert "NSFW check" in caplog.text


def test_policy_blocks_logos_not_plain_products():
    assert "visible logo" in moderation.POLICY and "plain laptop" in moderation.POLICY
    assert "branded product" not in moderation.POLICY


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


def test_production_without_keys_refuses_instead_of_skipping(monkeypatch, image):
    """Live, missing keys must not mean unchecked AI media: the task fails and is refunded."""
    monkeypatch.delenv("FAL_KEY")
    monkeypatch.setenv("OPENCMO_ENV", "production")
    with pytest.raises(ProviderError) as blocked:
        moderation.check_output(get_model("fal-nano-banana"), {"prompt": "x"}, image)
    assert not blocked.value.retryable and "refunded" in str(blocked.value)


def test_fake_models_never_run_in_production(monkeypatch):
    from opencmo.ai.providers import fake_allowed

    monkeypatch.setenv("OPENCMO_AI_FAKE", "1")
    assert fake_allowed()
    monkeypatch.setenv("OPENCMO_ENV", "production")
    assert not fake_allowed()


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


def test_an_edit_of_the_clips_own_video_uses_the_own_footage_policy(monkeypatch, image):
    _nsfw(monkeypatch)
    claude = _claude(monkeypatch)
    monkeypatch.setattr(moderation, "_frames", lambda _path, _workdir: [image])
    edit = get_model("fal-kling-edit")
    moderation.check_output(edit, {"prompt": "make it night", "sourceVideo": "renders:u/clip/master/1.mp4"}, image)
    assert claude["system"] == moderation.OWN_FOOTAGE_POLICY
    moderation.check_output(edit, {"prompt": "make it night", "sourceVideo": "u/library/a.mp4"}, image)
    assert claude["system"] == moderation.POLICY, "a library file may show anyone"


# ---------------------------------------------------------------- Gemini as the standby checker


def _http(monkeypatch, gemini=None, gemini_status=200, nsfw_flags=(False,)):
    """fal's NSFW check answers clean; `gemini` is the JSON text Gemini returns (or a full body)."""
    seen = {"gemini": []}

    def post(url, **kwargs):
        if "generativelanguage" in url:
            seen["gemini"].append({"url": url, **kwargs})
            body = gemini if isinstance(gemini, dict) else {"candidates": [{"content": {"parts": [{"text": gemini}]}}]}
            return httpx.Response(gemini_status, json=body, request=httpx.Request("POST", url))
        return httpx.Response(200, json={"has_nsfw_concepts": list(nsfw_flags)}, request=httpx.Request("POST", url))

    monkeypatch.setattr(moderation.httpx, "post", post)
    return seen


def _status(code, text):
    def make(_rate, status):
        error = status(text)
        error.status_code = code
        return error

    return make


NO_CREDIT = _status(400, "Your credit balance is too low to access the Anthropic API.")
ALLOW = '{"allowed": true, "category": "none"}'
BLOCK = '{"allowed": false, "category": "brand"}'


@pytest.mark.parametrize("error", [NO_CREDIT, _status(401, "invalid x-api-key"), lambda rate, _status: rate("slow down")])
def test_gemini_checks_when_claude_cannot_answer(monkeypatch, image, error):
    monkeypatch.setenv("GEMINI_API_KEY", "gem")
    _claude(monkeypatch, error=error)
    seen = _http(monkeypatch, gemini=ALLOW)
    moderation.check_images([image], moderation.OWN_FOOTAGE_POLICY)
    (request,) = seen["gemini"]
    assert request["headers"]["x-goog-api-key"] == "gem"
    body = request["json"]
    assert body["systemInstruction"]["parts"][0]["text"] == moderation.OWN_FOOTAGE_POLICY, "the same policy"
    assert body["contents"][0]["parts"][0]["inlineData"]["mimeType"] == "image/png"

    _http(monkeypatch, gemini=BLOCK)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert str(err.value) == moderation.BLOCKED and not err.value.retryable


def test_claudes_verdict_is_final_and_gemini_is_not_asked(monkeypatch, image):
    monkeypatch.setenv("GEMINI_API_KEY", "gem")
    _claude(monkeypatch, allowed=False)
    seen = _http(monkeypatch, gemini=ALLOW)
    with pytest.raises(ProviderError):
        moderation.check_images([image])
    # A request of ours that Claude rejects is not an outage: still blocked, nobody else is asked.
    _claude(monkeypatch, error=_status(400, "messages: image too large"))
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert not err.value.retryable
    assert seen["gemini"] == []


def test_neither_checker_answering_never_passes(monkeypatch, image):
    monkeypatch.setenv("GEMINI_API_KEY", "gem")
    _claude(monkeypatch, error=NO_CREDIT)
    _http(monkeypatch, gemini=ALLOW, gemini_status=503)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert err.value.retryable, "busy: tried again in place, then failed for good"

    for unreadable in ("looks fine to me", '{"allowed": "yes"}', {"promptFeedback": {"blockReason": "SAFETY"}}, {"candidates": []}):
        _http(monkeypatch, gemini=unreadable)
        with pytest.raises(ProviderError) as err:
            moderation.check_images([image])
        assert str(err.value) == moderation.BLOCKED and not err.value.retryable

    _http(monkeypatch, gemini=ALLOW, gemini_status=403)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert not err.value.retryable


def test_without_a_gemini_key_an_unpaid_claude_still_blocks(monkeypatch, image):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    _claude(monkeypatch, error=NO_CREDIT)
    seen = _http(monkeypatch, gemini=ALLOW)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert not err.value.retryable
    assert seen["gemini"] == []
