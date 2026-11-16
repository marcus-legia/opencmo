"""Sentry Cron heartbeat for the worker's own clock (web hardening round 2, item 2).

`sweep()` runs every queued job and task each minute (`modal_app.py`). If Modal stops calling it, jobs stay queued
and nothing says so. Each sweep now sends one check-in to Sentry's monitor `modal-sweep`; a missing one opens an issue.

This uses Sentry's plain HTTP check-in endpoint (`/api/<project>/cron/<slug>/<public key>/`) instead of `sentry_sdk`,
so the engine gains no dependency: `httpx` is already one. The check-in carries the monitor's config, so the monitor
is created by the first check-in and kept in step with the code.

Without `SENTRY_DSN` (local, tests, CI) every call is a no-op. A failed check-in only logs: monitoring must never
break the sweep.
"""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Callable
from urllib.parse import urlsplit

import httpx

log = logging.getLogger("opencmo.worker.cron_monitor")

SWEEP_SLUG = "modal-sweep"

# The sweep is `modal.Period(minutes=1)`. Sentry waits `checkin_margin` minutes past each expected minute before it
# counts a miss, and opens an issue only after `failure_issue_threshold` misses in a row: Modal skips a beat now and
# then, and one skipped minute is not an incident. Three minutes of margin and three misses is about five minutes
# without a sweep before anyone is told, well before a queued upload would look stuck (`/api/health`: ten minutes).
SWEEP_MONITOR: dict = {
    "schedule": {"type": "crontab", "value": "* * * * *"},
    "checkin_margin": 3,
    # The sweep's Modal timeout is 60 s.
    "max_runtime": 2,
    "failure_issue_threshold": 3,
    "recovery_threshold": 1,
    "timezone": "Etc/UTC",
}

# httpx times each phase on its own (pool, connect, write, read), so the worst case is their sum: 1 + 2 + 1 + 2 = 6 s.
# A slow Sentry then cannot push a long sweep past its 60 s Modal timeout and lose the heartbeat with it.
_TIMEOUT = httpx.Timeout(connect=2.0, read=2.0, write=1.0, pool=1.0)
_KEY = re.compile(r"^\w+$")
_HOST = re.compile(r"^[\w-]+(\.[\w-]+)*$")
_PROJECT = re.compile(r"^\d+$")


def checkin_url(dsn: str | None, slug: str) -> str | None:
    """The check-in URL for `slug`, or None when the DSN is unset or malformed.

    A DSN is `https://<public key>@<host>[:port]/[<path>/]<project id>`; the endpoint is
    `https://<host>[:port]/[<path>/]api/<project id>/cron/<slug>/<public key>/`. A cut-off DSN (the web app's was, on
    2026-11-16) is rejected here rather than sent somewhere wrong.
    """
    value = (dsn or "").strip()
    if not value:
        return None
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        return None
    path, _, project = parts.path.rpartition("/")
    key = parts.username or ""
    host = parts.hostname or ""
    if (
        parts.scheme not in ("https", "http")
        or not _KEY.match(key)
        or parts.password
        or not _HOST.match(host)
        or not _PROJECT.match(project)
        or parts.query
        or parts.fragment
    ):
        return None
    netloc = f"{host}:{port}" if port else host
    return f"{parts.scheme}://{netloc}{path}/api/{project}/cron/{slug}/{key}/"


def check_in(
    slug: str,
    status: str,
    monitor_config: dict,
    *,
    env: dict[str, str] | None = None,
    post: Callable[..., httpx.Response] = httpx.post,
) -> bool:
    """Send one check-in. True when Sentry accepted it; False for no DSN, a bad DSN or any failure."""
    env = os.environ if env is None else env
    dsn = env.get("SENTRY_DSN", "")
    url = checkin_url(dsn, slug)
    if url is None:
        if dsn.strip():
            # Never log the value: it is a key, and the log is shared.
            log.warning("SENTRY_DSN is set but is not a valid DSN; the %s check-in is off", slug)
        return False
    # Sentry files a check-in without an environment under `production`; a staging worker sets its own.
    environment = env.get("SENTRY_ENVIRONMENT", "").strip()
    try:
        resp = post(
            url,
            params={"environment": environment} if environment else None,
            json={"status": status, "monitor_config": monitor_config},
            timeout=_TIMEOUT,
        )
    except Exception as exc:  # noqa: BLE001 - monitoring must never break the sweep
        log.warning("Sentry check-in %s failed: %s", slug, type(exc).__name__)
        return False
    if resp.status_code >= 300:
        log.warning("Sentry check-in %s refused: HTTP %s", slug, resp.status_code)
        return False
    return True
