"""Page capture (C3/C4): a real Chromium against a fixture page served by the test.

The fixture server listens on 127.0.0.1, which the capture refuses like any local address; the
tests open exactly that `(host, port)` through `Guard.allow` and nothing else. Every SSRF case
then uses the default policy for its target: loopback, link-local metadata, a redirect into a
private address, and a subresource on a local port that must never receive a request.
"""

from __future__ import annotations

import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Self

import pytest

from opencmo.capture.addresses import blocked_name, private_address
from opencmo.capture.guard import Guard
from opencmo.capture.page import NOT_ALLOWED, NOT_OPENED, CaptureError, capture, check_url

CHROMIUM = next(iter(sorted(Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome"))), None)


def _browser_available() -> bool:
    try:
        import playwright  # noqa: F401
    except ImportError:
        return False
    return CHROMIUM is not None or bool(os.environ.get("PLAYWRIGHT_BROWSERS_PATH"))


needs_browser = pytest.mark.skipif(not _browser_available(), reason="Playwright with Chromium is not installed")

README = """<!doctype html><html><head><title>owner/repo: skills for agents</title>
<style>body{font:16px/1.5 sans-serif;margin:40px} .big{height:1600px}</style></head><body>
<h1>owner/repo</h1>
<p>This repository ships <b>24 lifecycle skills</b> for coding agents.</p>
<div class="big"></div>
<p id="low">Installed by 1,200 teams.</p>
<p style="display:none">hidden words</p>
{extra}
</body></html>"""


class _Server:
    """A tiny HTTP server on 127.0.0.1 whose routes the test sets; it counts every request."""

    def __init__(self, routes: dict[str, tuple[int, dict[str, str], bytes]]) -> None:
        self.routes = routes
        self.hits: list[str] = []
        server = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                server.hits.append(self.path)
                status, headers, body = server.routes.get(self.path, (404, {}, b"not found"))
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args: object) -> None:
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self) -> Self:
        self.thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def _html(body: str) -> tuple[int, dict[str, str], bytes]:
    return 200, {"Content-Type": "text/html; charset=utf-8"}, body.encode()


def _run(url: str, guard: Guard) -> dict:
    return capture({"url": url, "width": 1280, "max_height": 8000}, guard,
                   executable_path=str(CHROMIUM) if CHROMIUM else None)


# ---- Address rules (no browser).

@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.0.0.8", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
    "2002:7f00:0001::", "64:ff9b::a9fe:a9fe", "not an ip",
])
def test_private_addresses_are_refused(address: str) -> None:
    assert private_address(address)


@pytest.mark.parametrize("address", ["140.82.112.3", "1.1.1.1", "2606:4700:4700::1111"])
def test_public_addresses_pass(address: str) -> None:
    assert not private_address(address)


@pytest.mark.parametrize("name", ["localhost", "db", "api.localhost", "printer.local", "metadata.google.internal"])
def test_local_names_are_refused(name: str) -> None:
    assert blocked_name(name)


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://localhost:3000",
    "https://github.com:8443/", "file:///etc/passwd", "https://user:pw@github.com/", "http://[::1]/",
])
def test_check_url_refuses_before_any_browser(url: str) -> None:
    with pytest.raises(CaptureError, match=NOT_ALLOWED):
        check_url(url, Guard())


# ---- A real capture.

@needs_browser
def test_captures_the_page_with_word_boxes() -> None:
    with _Server({"/": _html(README.replace("{extra}", ""))}) as server:
        result = _run(server.base + "/", Guard(allow=frozenset({("127.0.0.1", server.port)})))
    png, boxes = result["png"], result["boxes"]
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    width = int.from_bytes(png[16:20], "big")
    height = int.from_bytes(png[20:24], "big")
    assert (width, height) == (1280 * 2, boxes["height"] * 2)
    assert boxes["width"] == 1280 and boxes["scale"] == 2 and boxes["height"] > 1600
    assert boxes["title"] == "owner/repo: skills for agents"
    words = [run["text"] for run in boxes["runs"]]
    start = words.index("24")
    assert words[start:start + 3] == ["24", "lifecycle", "skills"]
    assert "hidden" not in words
    x, y, w, h = boxes["runs"][start]["rect"]
    assert 0 < x < 1280 and 0 < y < 400 and w > 0 and h > 0
    # Document coordinates: the paragraph below the 1600 px block is found below it.
    low = boxes["runs"][words.index("Installed")]["rect"]
    assert low[1] > 1600


# ---- SSRF: every path into a local address is closed.

@needs_browser
@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://169.254.169.254/", "http://localhost:3000/"])
def test_local_targets_are_refused(url: str) -> None:
    with pytest.raises(CaptureError, match=NOT_ALLOWED):
        _run(url, Guard())


@needs_browser
@pytest.mark.parametrize("target", ["http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "https://127.0.0.1/"])
def test_a_redirect_to_a_private_address_is_refused(target: str) -> None:
    routes = {"/": (302, {"Location": target}, b"")}
    with _Server(routes) as server:
        guard = Guard(allow=frozenset({("127.0.0.1", server.port)}))
        with pytest.raises(CaptureError, match=NOT_ALLOWED):
            _run(server.base + "/", guard)
    assert guard.blocked


@needs_browser
def test_a_redirect_to_another_local_port_never_reaches_it() -> None:
    inner = _Server({"/secret": _html("secret")})
    with inner, _Server({"/": (302, {"Location": f"{inner.base}/secret"}, b"")}) as outer:
        guard = Guard(allow=frozenset({("127.0.0.1", outer.port)}))
        with pytest.raises(CaptureError, match=NOT_ALLOWED):
            _run(outer.base + "/", guard)
    assert inner.hits == []


@needs_browser
def test_subresources_on_private_addresses_are_blocked_and_the_page_still_captures() -> None:
    with _Server({"/pixel.png": (200, {"Content-Type": "image/png"}, b"x"), "/api": _html("{}")}) as inner:
        extra = (
            f'<img src="{inner.base}/pixel.png">'
            '<img src="http://169.254.169.254/latest/meta-data/">'
            f'<script>fetch("{inner.base}/api").catch(() => {{}});'
            f'try {{ new WebSocket("ws://127.0.0.1:{inner.port}/ws"); }} catch (e) {{}}</script>'
        )
        with _Server({"/": _html(README.replace("{extra}", extra))}) as outer:
            guard = Guard(allow=frozenset({("127.0.0.1", outer.port)}))
            result = _run(outer.base + "/", guard)
        assert inner.hits == []
    assert any(item.startswith("169.254.169.254") for item in guard.blocked)
    assert any(item == f"127.0.0.1:{inner.port}" for item in guard.blocked)
    assert result["boxes"]["runs"]


@needs_browser
def test_a_missing_page_is_not_opened() -> None:
    with _Server({}) as server, pytest.raises(CaptureError, match=NOT_OPENED):
        _run(server.base + "/nope", Guard(allow=frozenset({("127.0.0.1", server.port)})))
