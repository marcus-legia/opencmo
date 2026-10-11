"""Moment selection runs on Claude."""

from __future__ import annotations

import pytest

from opencmo.config import Config


def _cfg(monkeypatch, **env: str) -> Config:
    for name in ("ANTHROPIC_API_KEY", "OPENCMO_SELECT_MODEL"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return Config()


def test_default_model_is_haiku(monkeypatch):
    assert _cfg(monkeypatch, ANTHROPIC_API_KEY="a").resolved_select_model == "claude-haiku-5-5"


def test_model_can_be_overridden(monkeypatch):
    cfg = _cfg(monkeypatch, ANTHROPIC_API_KEY="a", OPENCMO_SELECT_MODEL="claude-sonnet-5-5")
    assert cfg.resolved_select_model == "claude-sonnet-5-5"


def test_missing_key_fails_clearly(monkeypatch):
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        _cfg(monkeypatch).validate_for_select()


def test_haiku_5_selects_at_low_effort_and_4_5_without_effort(monkeypatch):
    import sys
    import types

    from opencmo.steps import select

    sent: list[dict] = []

    class Messages:
        def parse(self, **kwargs):
            sent.append(kwargs)
            return types.SimpleNamespace(parsed_output="ok")

    class Anthropic:
        def __init__(self, **_kwargs):
            self.messages = Messages()

    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=Anthropic))
    for model in ("claude-haiku-5-5", "claude-haiku-4-5"):
        assert select._select_with_anthropic("x", Config(anthropic_api_key="k", select_model=model)) == "ok"
    assert sent[0]["output_config"] == {"effort": "low"}
    assert "output_config" not in sent[1], "Haiku 4.5 rejects effort"
