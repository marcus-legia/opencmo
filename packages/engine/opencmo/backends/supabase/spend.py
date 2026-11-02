"""The spend ledger's worker side: one row per paid provider call (RPC ``provider_usage_record``)."""

from __future__ import annotations

import logging
from typing import Any

from opencmo.backends.supabase.http import _Http

log = logging.getLogger(__name__)


class SpendMixin(_Http):
    def record_provider_usage(
        self,
        user_id: str,
        provider: str,
        model: str,
        units: dict[str, Any],
        *,
        ref_kind: str,
        ref_id: str | None,
    ) -> None:
        """Best effort: a failed write is logged, never raised, so it cannot fail a paid generation."""
        try:
            self._rpc(
                "provider_usage_record",
                {"p_user": user_id, "p_provider": provider, "p_model": model, "p_units": units, "p_ref_kind": ref_kind, "p_ref_id": ref_id},
                idempotent=False,
            ).raise_for_status()
        except Exception:
            log.exception("Could not record provider usage for %s/%s", provider, model)
