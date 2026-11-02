"""What one media generation cost OpenCMO at the provider, for the spend ledger (provider_usage).

The units are the provider's own (a generation, seconds of video, 1,000 characters of voice), keyed
``<model id>:<unit>`` so each model can carry its own price in ``provider_prices``. A unit with no price
row is stored unpriced: the ledger never guesses a dollar figure.
"""

from __future__ import annotations

import math
from typing import Any

from opencmo.ai.catalog import AiModel

#: Catalog providers OpenCMO pays per call. Motion renders on our own worker; the fake provider costs nothing.
PAID_PROVIDERS = {"fal", "elevenlabs"}


def media_units(model: AiModel, spec: dict[str, Any], duration: float | None) -> dict[str, int] | None:
    """None for a model OpenCMO does not pay a provider for."""
    if model.provider not in PAID_PROVIDERS:
        return None
    unit = str(model.price.get("unit") or "generation")
    if unit == "second":
        seconds = duration if duration and duration > 0 else float(spec.get("duration") or 1)
        return {f"{model.id}:second": max(1, math.ceil(seconds))}
    if unit == "kchars":
        return {f"{model.id}:kchars": max(1, math.ceil(len(str(spec.get("prompt") or "").strip()) / 1000))}
    return {f"{model.id}:generation": 1}
