"""Spend ledger units for media generations (docs/plans/cmo/2026-11-02-provider-spend-ledger-plan.md)."""

from opencmo.ai.catalog import AiModel
from opencmo.ai.spend import media_units


def _model(provider: str, unit: str, id_: str = "m") -> AiModel:
    return AiModel(id=id_, kind="video", provider=provider, name="M", price={"unit": unit, "credits": 1}, limits={})


def test_paid_providers_record_their_own_units_per_model():
    assert media_units(_model("fal", "second", "fal-veo"), {"duration": 7.2}, None) == {"fal-veo:second": 8}
    assert media_units(_model("fal", "second", "fal-veo"), {"duration": 5}, 6.04) == {"fal-veo:second": 7}
    assert media_units(_model("fal", "generation", "fal-image"), {}, None) == {"fal-image:generation": 1}
    assert media_units(_model("elevenlabs", "kchars", "voice"), {"prompt": "x" * 1001}, None) == {"voice:kchars": 2}


def test_our_own_renders_and_fakes_cost_no_provider():
    assert media_units(_model("opencmo-motion", "explainer"), {}, None) is None
    assert media_units(_model("fake", "generation"), {}, None) is None
