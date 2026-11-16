"""The sweep's Sentry heartbeat (`opencmo/worker/cron_monitor.py`). No network."""

from __future__ import annotations

import ast
import logging
from pathlib import Path

import httpx
import pytest

from opencmo.worker import cron_monitor

KEY = "0123456789abcdef0123456789abcdef"  # gitleaks:allow (made-up DSN key)
DSN = f"https://{KEY}@o1.ingest.us.sentry.io/42"
MODAL_APP = Path(__file__).resolve().parent.parent / "modal_app.py"


class Recorder:
    def __init__(self, response: httpx.Response | Exception | None = None) -> None:
        self.calls: list[dict] = []
        self.response = response if response is not None else httpx.Response(202)

    def __call__(self, url: str, **kwargs) -> httpx.Response:
        self.calls.append({"url": url, **kwargs})
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def test_no_dsn_is_a_no_op():
    post = Recorder()
    assert cron_monitor.check_in("modal-sweep", "ok", {}, env={}, post=post) is False
    assert cron_monitor.check_in("modal-sweep", "ok", {}, env={"SENTRY_DSN": "  "}, post=post) is False
    assert post.calls == []


def test_checkin_url_from_dsn():
    assert (
        cron_monitor.checkin_url(DSN, "modal-sweep")
        == f"https://o1.ingest.us.sentry.io/api/42/cron/modal-sweep/{KEY}/"
    )
    # Self-hosted Sentry: a port and a path prefix stay in place.
    assert (
        cron_monitor.checkin_url(f"http://{KEY}@sentry.local:9000/base/7", "s")
        == f"http://sentry.local:9000/base/api/7/cron/s/{KEY}/"
    )
    assert cron_monitor.checkin_url(f"http://{KEY}@localhost:9000/1", "s") == (
        f"http://localhost:9000/api/1/cron/s/{KEY}/"
    )


@pytest.mark.parametrize(
    "dsn",
    [
        f"https://{KEY}@o1.ingest.us.",  # the truncation the web app's DSN had on 2026-11-16
        f"https://{KEY}@o1.ingest.us.sentry.io/",
        "https://o1.ingest.us.sentry.io/42",
        f"ftp://{KEY}@o1.ingest.us.sentry.io/42",
        f"https://{KEY}:secret@o1.ingest.us.sentry.io/42",
        f"https://{KEY}@o1.ingest.us.sentry.io/42?x=1",
        f"https://{KEY}@o1.ingest.us.sentry.io:notaport/42",
    ],
)
def test_malformed_dsn_is_off_and_never_logged(dsn, caplog):
    post = Recorder()
    with caplog.at_level(logging.WARNING, logger="opencmo.worker.cron_monitor"):
        assert cron_monitor.check_in("modal-sweep", "ok", {}, env={"SENTRY_DSN": dsn}, post=post) is False
    assert post.calls == []
    assert "not a valid DSN" in caplog.text
    assert KEY not in caplog.text


def test_check_in_posts_status_and_config():
    post = Recorder()
    ok = cron_monitor.check_in(
        "modal-sweep", "ok", cron_monitor.SWEEP_MONITOR, env={"SENTRY_DSN": DSN}, post=post
    )
    assert ok is True
    (call,) = post.calls
    assert call["url"] == f"https://o1.ingest.us.sentry.io/api/42/cron/modal-sweep/{KEY}/"
    assert call["json"] == {"status": "ok", "monitor_config": cron_monitor.SWEEP_MONITOR}
    assert call["params"] is None
    assert call["timeout"] is not None


def test_environment_goes_in_the_query():
    post = Recorder()
    cron_monitor.check_in("s", "ok", {}, env={"SENTRY_DSN": DSN, "SENTRY_ENVIRONMENT": "staging"}, post=post)
    assert post.calls[0]["params"] == {"environment": "staging"}


@pytest.mark.parametrize("response", [httpx.ConnectTimeout("slow"), RuntimeError("boom"), httpx.Response(429)])
def test_a_failed_check_in_never_raises(response, caplog):
    post = Recorder(response)
    with caplog.at_level(logging.WARNING, logger="opencmo.worker.cron_monitor"):
        assert cron_monitor.check_in("s", "ok", {}, env={"SENTRY_DSN": DSN}, post=post) is False
    assert KEY not in caplog.text


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(MODAL_APP.read_text(encoding="utf-8"))
    return next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)


def test_sweep_checks_in_whatever_happens():
    sweep = _function("sweep")
    (body,) = [n for n in sweep.body if isinstance(n, ast.Try)]
    assert "check_in" in ast.unparse(body.finalbody), "the heartbeat sits in `finally`"
    assert "_sweep_once" in ast.unparse(body.body)


def test_monitor_schedule_is_the_sweeps():
    # `sweep` runs on `modal.Period(minutes=1)`; the monitor expects a check-in every minute.
    decorator = ast.unparse(_function("sweep").decorator_list[0])
    assert "modal.Period(minutes=1)" in decorator
    assert cron_monitor.SWEEP_MONITOR["schedule"] == {"type": "crontab", "value": "* * * * *"}
    assert cron_monitor.SWEEP_MONITOR["max_runtime"] * 60 > 60, "longer than the sweep's Modal timeout"
