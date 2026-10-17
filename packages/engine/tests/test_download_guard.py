"""yt-dlp goes through the address guard when no outbound proxy is set (fix 7, worker side).

`validate_public_url` checks the link once; yt-dlp then follows redirects and extractor hops on
its own. Without the guard, a public page that answers 302 → an internal address gets fetched
from inside the worker's network. These tests use two local servers: A is the "public" page
(allowed for the test, like `Guard.allow` in test_capture_page.py), B stands in for an internal
service that must never be reached.
"""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from opencmo.capture.guard import Guard, GuardProxyThread
from opencmo.config import Config
from opencmo.steps import download

VIDEO = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64


class _Server:
    def __init__(self, routes: dict[str, tuple[int, dict[str, str], bytes]]) -> None:
        self.hits: list[str] = []
        hits, table = self.hits, routes

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                hits.append(self.path)
                status, headers, body = table.get(self.path, (404, {}, b""))
                self.send_response(status)
                for key, value in {"Content-Length": str(len(body)), **headers}.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(body)

            do_HEAD = do_GET

            def log_message(self, *_args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.base = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()


@pytest.fixture
def servers():
    inside = _Server({"/secret.mp4": (200, {"Content-Type": "video/mp4"}, VIDEO)})
    outside = _Server({
        "/video.mp4": (200, {"Content-Type": "video/mp4"}, VIDEO),
        "/redirect": (302, {"Location": f"{inside.base}/secret.mp4"}, b""),
        "/redirect-80": (302, {"Location": "http://127.0.0.1/secret.mp4"}, b""),
    })
    yield outside, inside
    outside.close()
    inside.close()


@pytest.fixture
def guard(monkeypatch: pytest.MonkeyPatch, servers):
    outside, _ = servers
    test_guard = Guard(allow=frozenset({("127.0.0.1", outside.port)}))
    with GuardProxyThread(test_guard) as proxy:
        monkeypatch.setattr(download, "shared_proxy_url", lambda: proxy.url)
        yield test_guard


def test_without_a_proxy_ytdlp_goes_through_the_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(download, "shared_proxy_url", lambda: "http://127.0.0.1:1")
    assert download._base_opts(Config(proxy=None))["proxy"] == "http://127.0.0.1:1"


def test_an_outbound_proxy_replaces_the_guard() -> None:
    assert download._base_opts(Config(proxy="http://proxy.example.com:1234"))["proxy"] == "http://proxy.example.com:1234"


def test_a_public_link_still_works_through_the_guard(servers, guard: Guard) -> None:
    outside, _ = servers
    info = download.probe(f"{outside.base}/video.mp4", Config(proxy=None))
    assert info.url.endswith("/video.mp4")
    assert "/video.mp4" in outside.hits
    assert guard.blocked == []


@pytest.mark.parametrize("path", ["/redirect", "/redirect-80"])
def test_a_redirect_to_an_internal_address_is_refused(servers, guard: Guard, path: str) -> None:
    import yt_dlp

    outside, inside = servers
    with pytest.raises(yt_dlp.utils.DownloadError):
        download.probe(f"{outside.base}{path}", Config(proxy=None))
    assert inside.hits == []
    assert any(entry.startswith("127.0.0.1:") for entry in guard.blocked)
