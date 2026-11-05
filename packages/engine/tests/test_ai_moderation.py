"""Moderation is Creem's (D8): prompts go through Creem only; outputs are reviewed by fal's NSFW classifier plus Claude
against Creem's quoted rules (`CREEM_POLICY`), both must pass; failures never pass."""

from __future__ import annotations

import sys
import types
from typing import Any

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
    # The machine's own keys must not change which checker runs.
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "OPENAI_COMPAT_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        monkeypatch.delenv(name, raising=False)
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
    assert claude["system"] == moderation.CREEM_POLICY
    assert claude["output_config"] == {"effort": "low"}
    assert claude["messages"][0]["content"][0]["type"] == "image"


def test_every_output_is_reviewed_against_creems_rules_only(monkeypatch, image):
    """No policy of ours (D8): a cut-out of the user's own footage, an edit of the clip and a library file all get Creem's rules."""
    _nsfw(monkeypatch)
    claude = _claude(monkeypatch)
    monkeypatch.setattr(moderation, "_frames", lambda _path, _workdir: [image])
    moderation.check_output(get_model("fal-veed-cutout"), {"prompt": "a beach"}, image)
    assert claude["system"] == moderation.CREEM_POLICY
    moderation.check_output(get_model("fal-kling-edit"), {"prompt": "make it night", "sourceVideo": "renders:u/clip/master/1.mp4"}, image)
    assert claude["system"] == moderation.CREEM_POLICY


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


def test_the_review_policy_is_creems_rules_quoted():
    assert "face-swap, deepfake, or face-manipulation" in moderation.CREEM_POLICY
    assert "sexually provocative" in moderation.CREEM_POLICY and "harmful content" in moderation.CREEM_POLICY
    for ours in ("real person", "logo", "trademark", "brand"):
        assert ours not in moderation.CREEM_POLICY.lower(), ours
    for gone in ("POLICY", "OWN_FOOTAGE_POLICY", "CAPTURE_POLICY", "PROMPT_POLICY", "AUDIO_PROMPT_POLICY", "MOTION_PROMPT_POLICY", "check_input", "check_input_video"):
        assert not hasattr(moderation, gone), gone


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
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    monkeypatch.setattr(moderation.httpx, "post", lambda *_a, **_k: pytest.fail("no call without keys"))
    moderation.check_output(get_model("fal-nano-banana"), {"prompt": "x"}, image)
    assert not moderation.ready()


def test_production_without_keys_refuses_instead_of_skipping(monkeypatch, image):
    """Live, missing keys must not mean unchecked AI media: the task fails and is refunded."""
    monkeypatch.delenv("ANTHROPIC_API_KEY")
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


# ---------------------------------------------------------------- Claude is the only checker


def _status(code, text):
    def make(_rate, status):
        error = status(text)
        error.status_code = code
        return error

    return make


NO_CREDIT = _status(400, "Your credit balance is too low to access the Anthropic API.")


@pytest.mark.parametrize("error", [NO_CREDIT, _status(401, "invalid x-api-key"), _status(403, "forbidden")])
def test_an_unpaid_or_revoked_claude_is_unavailable_not_a_block(monkeypatch, image, error):
    _nsfw(monkeypatch)
    _claude(monkeypatch, error=error)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert str(err.value) == moderation.UNAVAILABLE and not err.value.retryable


def test_other_vendors_keys_are_never_used(monkeypatch, image):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    for name in ("GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_COMPAT_API_KEY"):
        monkeypatch.setenv(name, "x")
    assert not moderation.ready(), "Claude only: another vendor's key does not set up moderation"


def test_a_request_claude_rejects_still_blocks(monkeypatch, image):
    _nsfw(monkeypatch)
    _claude(monkeypatch, error=_status(400, "messages: image too large"))
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert str(err.value) == moderation.BLOCKED and not err.value.retryable


def test_no_llm_judges_a_prompt(monkeypatch):
    """Even an unpaid Claude cannot block or fail a prompt: Claude is never asked about one."""
    seen = _claude(monkeypatch, error=NO_CREDIT)
    monkeypatch.delenv("CREEM_API_KEY", raising=False)
    moderation.check_prompt(get_model("gemini-image"), {"prompt": "a red fox", "aspectRatio": "1:1"})
    assert seen == {}


def test_an_unpaid_nsfw_check_is_unavailable_not_blocked(monkeypatch, image):
    _nsfw(monkeypatch, status=402)
    with pytest.raises(ProviderError) as err:
        moderation.check_images([image])
    assert str(err.value) == moderation.UNAVAILABLE and not err.value.retryable


@pytest.mark.parametrize("model_id", ["fal-veo", "fal-kling-v3"])
def test_long_take_shots_are_checked_frame_by_frame_before_upload(monkeypatch, image, model_id):
    """Long take, Task 1: the new rows are `video` on `fal`, so their frames go through the checkers."""
    nsfw = _nsfw(monkeypatch)
    claude = _claude(monkeypatch)
    monkeypatch.setattr(moderation, "_frames", lambda _path, _workdir: [image])
    model = get_model(model_id)
    assert moderation.needs_check(model)
    moderation.check_output(model, {"prompt": "a desk at dawn"}, image)
    assert nsfw["url"] == moderation.NSFW_ENDPOINT
    assert claude["system"] == moderation.CREEM_POLICY


# --------------------------------------------------------------- garbled text (long take, Task 6)


@pytest.fixture
def garbled(tmp_path):
    """A real PNG with gibberish shop-sign letters, the kind of keyframe the badge is for."""
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg missing")
    path = tmp_path / "garbled.png"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x334455:s=540x960",
         "-vf", "drawtext=text='OPNECMMO SLOO FUNDRES':fontcolor=white:fontsize=48:x=40:y=420",
         "-frames:v", "1", str(path)],
        check=True,
    )
    return path


def test_a_garbled_keyframe_gets_a_severe_hint(monkeypatch, garbled):
    asked = []

    def claude(path):
        asked.append(path)
        return {"text": "severe", "_usage": 12}

    monkeypatch.setattr(moderation, "_ask_claude", claude)
    assert moderation.text_quality(get_model("fal-nano-banana"), {"prompt": "a shop"}, garbled) == {"text": "severe"}
    assert asked == [garbled], "one vision call per image"


def test_the_text_hint_gives_up_quietly(monkeypatch, garbled):
    monkeypatch.setattr(moderation, "_ask_claude", lambda _path: (_ for _ in ()).throw(RuntimeError("down")))
    assert moderation.text_quality(get_model("fal-nano-banana"), {"prompt": "x"}, garbled) is None, "an error: no hint, no failure"
    monkeypatch.setattr(moderation, "_ask_claude", lambda _path: {"text": "unreadable"})
    assert moderation.text_quality(get_model("fal-nano-banana"), {"prompt": "x"}, garbled) is None, "no valid answer: no hint"
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    monkeypatch.setattr(moderation, "_ask_claude", lambda _path: pytest.fail("no key: no call"))
    assert moderation.text_quality(get_model("fal-nano-banana"), {"prompt": "x"}, garbled) is None


def test_the_text_hint_is_for_images_and_fake_mode_marks_it(monkeypatch, garbled):
    monkeypatch.setattr(moderation.httpx, "post", lambda *_a, **_k: pytest.fail("no call"))
    assert moderation.text_quality(get_model("fal-veo"), {"prompt": "x"}, garbled) is None, "videos are not checked"
    fake = get_model("fake-image")
    assert moderation.text_quality(fake, {"prompt": f"a sign {moderation.FAKE_GARBLED}"}, garbled) == {"text": "severe"}
    assert moderation.text_quality(fake, {"prompt": "a sign"}, garbled) is None


# ---------------------------------------------------------------- the prompt, again on the worker


def test_a_prompt_creem_denies_fails_before_any_provider(monkeypatch):
    seen = _claude(monkeypatch)
    calls = []
    monkeypatch.setenv("CREEM_API_KEY", "creem_test_k")
    monkeypatch.setattr(moderation.httpx, "post", lambda url, **kwargs: calls.append(kwargs) or _CreemReply({"decision": "deny"}))
    with pytest.raises(ProviderError) as err:
        moderation.check_prompt(get_model("gemini-image"), {"prompt": "Taylor Swift on stage", "aspectRatio": "1:1"})
    assert str(err.value) == moderation.PROMPT_BLOCKED and not err.value.retryable
    assert calls[0]["json"] == {"prompt": "Taylor Swift on stage"}
    assert seen == {}, "Creem decides; no LLM is asked"


def test_voice_prompts_are_not_screened(monkeypatch):
    """Creem does not require it for audio, and we add no check of our own (D8)."""
    seen = _claude(monkeypatch, allowed=False)
    monkeypatch.setenv("CREEM_API_KEY", "creem_test_k")
    monkeypatch.setattr(moderation.httpx, "post", lambda *_a, **_k: pytest.fail("audio never calls Creem"))
    moderation.check_prompt(get_model("gemini-voice"), {"prompt": "Welcome to our bakery.", "voice": "Aria"})
    assert seen == {}


def test_prompt_text_reads_what_a_model_reads_and_skips_code_and_settings():
    spec = {
        "prompt": "Explainer: how it works", "aspectRatio": "16:9", "voice": "Aria", "code": "return 1;",
        "scene": {"template": "explainer", "code_ref": "a" * 64, "title": "How it works", "beats": [{"say": "Upload a video."}]},
    }
    assert moderation.prompt_text(spec) == ["Explainer: how it works", "How it works", "Upload a video."]


def test_prompt_check_without_keys_refuses_in_production(monkeypatch):
    monkeypatch.delenv("CREEM_API_KEY", raising=False)
    moderation.check_prompt(get_model("gemini-image"), {"prompt": "a red fox", "aspectRatio": "1:1"})
    monkeypatch.setenv("OPENCMO_ENV", "production")
    with pytest.raises(ProviderError) as err:
        moderation.check_prompt(get_model("gemini-image"), {"prompt": "a red fox", "aspectRatio": "1:1"})
    assert str(err.value) == moderation.NOT_CHECKED


class _CreemReply:
    def __init__(self, body: Any = None, status: int = 200) -> None:
        self.body, self.status_code = body, status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("failed", request=httpx.Request("POST", "http://x"), response=httpx.Response(self.status_code))

    def json(self) -> Any:
        if self.body is None:
            raise ValueError("not json")
        return self.body


def _creem(monkeypatch: pytest.MonkeyPatch, reply: Any) -> list[dict]:
    """Answers Creem's call and fails on any other, so the policy check stays out of the result: no LLM key is set."""
    calls: list[dict] = []

    def post(url: str, **kwargs: Any) -> Any:
        calls.append({"url": url, **kwargs})
        if isinstance(reply, Exception):
            raise reply
        return reply

    for name in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "CMO_LLM_API_KEY", "OPENCMO_ENV"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(moderation.httpx, "post", post)
    return calls


PROMPT_SPEC = {"prompt": "a red fox", "aspectRatio": "1:1"}


def test_creem_allow_goes_on_in_the_right_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _creem(monkeypatch, _CreemReply({"decision": "allow", "later": "ignored"}))
    monkeypatch.setenv("CREEM_API_KEY", "creem_test_k")
    moderation.check_prompt(get_model("gemini-image"), PROMPT_SPEC)
    assert calls[0]["url"] == "https://test-api.creem.io/v1/moderation/prompt"
    assert calls[0]["headers"]["x-api-key"] == "creem_test_k"
    assert calls[0]["json"] == {"prompt": "a red fox"}
    monkeypatch.setenv("CREEM_API_KEY", "creem_live_k")
    moderation.check_prompt(get_model("gemini-image"), PROMPT_SPEC)
    assert calls[1]["url"] == "https://api.creem.io/v1/moderation/prompt"


@pytest.mark.parametrize("decision", ["flag", "deny"])
def test_creem_flag_and_deny_block(monkeypatch: pytest.MonkeyPatch, decision: str) -> None:
    _creem(monkeypatch, _CreemReply({"decision": decision}))
    monkeypatch.setenv("CREEM_API_KEY", "creem_test_k")
    with pytest.raises(ProviderError) as blocked:
        moderation.check_prompt(get_model("gemini-image"), PROMPT_SPEC)
    assert str(blocked.value) == moderation.PROMPT_BLOCKED


@pytest.mark.parametrize(
    "reply",
    [
        _CreemReply({"decision": "something new"}),
        _CreemReply({"decision": "allow"}, status=500),
        _CreemReply(None),
        _CreemReply(["not an object"]),
        httpx.ConnectTimeout("slow"),
    ],
)
def test_creem_fails_closed(monkeypatch: pytest.MonkeyPatch, reply: Any) -> None:
    _creem(monkeypatch, reply)
    monkeypatch.setenv("CREEM_API_KEY", "creem_test_k")
    with pytest.raises(ProviderError) as failed:
        moderation.check_prompt(get_model("gemini-image"), PROMPT_SPEC)
    assert str(failed.value) == moderation.UNAVAILABLE


def test_creem_skips_audio_and_screens_motion(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _creem(monkeypatch, _CreemReply({"decision": "deny"}))
    monkeypatch.setenv("CREEM_API_KEY", "creem_test_k")
    moderation.check_prompt(get_model("gemini-voice"), {"prompt": "Welcome to our bakery.", "voice": "Aria"})
    assert calls == []
    with pytest.raises(ProviderError):
        moderation.check_prompt(get_model("motion-explainer"), {"prompt": "a banner", "aspectRatio": "16:9"})
    assert len(calls) == 1


def test_creem_key_rules(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _creem(monkeypatch, _CreemReply({"decision": "allow"}))
    monkeypatch.delenv("CREEM_API_KEY", raising=False)
    moderation.check_prompt(get_model("gemini-image"), PROMPT_SPEC)
    assert calls == [], "outside production, no key skips Creem"
    monkeypatch.setenv("OPENCMO_ENV", "production")
    for key in ("", "creem_test_k"):
        monkeypatch.setenv("CREEM_API_KEY", key)
        with pytest.raises(ProviderError) as refused:
            moderation.check_prompt(get_model("gemini-image"), PROMPT_SPEC)
        assert str(refused.value) == moderation.NOT_CHECKED
    assert calls == [], "the sandbox is never asked from production"
