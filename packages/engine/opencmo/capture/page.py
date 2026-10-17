"""Capture one public page: a full-page PNG plus where every word sits on it (C3).

Runs in its own Modal function with no secrets (`page_capture` in `modal_app.py`): the page's
JavaScript runs in this Chromium, so this process holds nothing worth stealing. It touches no
database or storage either; the worker task moderates and stores the result.

Output (docs/style-skills-build.md, Page capture):

- `png`: the page at device scale 2, 1280 CSS pixels wide, at most `max_height` CSS pixels tall;
- `boxes`: `{url, title, width, height, scale, runs: [{text, rect: [x, y, w, h]}]}` in CSS
  pixels, one run per word, in reading order. `add_proof` finds its focus across runs.

Every connection goes through `guard.GuardProxy`. Playwright's own hooks add what a proxy cannot
see: no scheme but http(s), no downloads, no service workers, no permissions, no popups, a fresh
context (no cookies kept).
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any
from urllib.parse import urlsplit

from opencmo.capture.addresses import DEFAULT_PORTS, blocked_name, private_address
from opencmo.capture.guard import Guard, GuardProxy

log = logging.getLogger(__name__)

# The sentences the worker writes to the task (and so to the user), from the contract.
NOT_OPENED = "That page could not be opened."
NOT_ALLOWED = "That address is not allowed."
TOO_LARGE = "That page is too large to capture."
BLOCKED = "This page did not pass the content check."
MESSAGES = (NOT_OPENED, NOT_ALLOWED, TOO_LARGE, BLOCKED)

WIDTH = 1280
SCALE = 2
MAX_HEIGHT = 8000
NAVIGATION_TIMEOUT_MS = 15_000
#: After the first paint: time for late images and fonts, then lazy content while scrolling.
SETTLE_SECONDS = 1.0
SCROLL_SECONDS = 3.0
#: More words than this is not a page anyone quotes from; the rest are dropped.
MAX_RUNS = 20_000
#: The PNG must fit the `captures` bucket (25 MB).
MAX_PNG_BYTES = 25 * 1024 * 1024

_LAUNCH_ARGS = [
    # No UDP around the proxy (WebRTC), no QUIC, no background network the page did not ask for.
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-quic",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--no-pings",
    "--dns-prefetch-disable",
    "--disable-features=DnsOverHttps,MediaRouter,OptimizationHints,Translate",
    "--mute-audio",
]

# Words with their rectangles, in document coordinates. Text inside hidden elements, scripts and
# styles is skipped; a word that wraps keeps its first line box.
_RUNS_JS = """
([maxRuns, maxHeight]) => {
  const runs = [];
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'svg']);
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || skip.has(parent.tagName) || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const range = document.createRange();
  const sx = window.scrollX, sy = window.scrollY;
  for (let node = walker.nextNode(); node && runs.length < maxRuns; node = walker.nextNode()) {
    const text = node.nodeValue;
    for (const match of text.matchAll(/\\S+/g)) {
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const rect = range.getClientRects()[0];
      if (!rect || rect.width < 1 || rect.height < 1) continue;
      const y = rect.top + sy;
      if (y >= maxHeight) continue;
      runs.push({ text: match[0], rect: [Math.round(rect.left + sx), Math.round(y), Math.round(rect.width), Math.round(rect.height)] });
      if (runs.length >= maxRuns) break;
    }
  }
  return { title: document.title || '', runs };
}
"""


class CaptureError(Exception):
    """A capture refused or failed; the message is one of `MESSAGES`, written for the user."""


def check_url(url: str, guard: Guard) -> tuple[str, int]:
    """The address itself, before a browser opens: http(s), no credentials, default port, a
    public-looking name. The proxy still checks what that name resolves to."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise CaptureError(NOT_ALLOWED) from exc
    if parts.scheme not in DEFAULT_PORTS or not parts.hostname or parts.username or parts.password:
        raise CaptureError(NOT_ALLOWED)
    host = parts.hostname.lower()
    port = port or DEFAULT_PORTS[parts.scheme]
    if (host, port) in guard.allow:
        return host, port
    if port != DEFAULT_PORTS[parts.scheme]:
        raise CaptureError(NOT_ALLOWED)
    if blocked_name(host) and not _ip_literal(host):
        raise CaptureError(NOT_ALLOWED)
    if _ip_literal(host) and private_address(host):
        raise CaptureError(NOT_ALLOWED)
    return host, port


def _hop(url: str) -> str:
    parts = urlsplit(url)
    return f"{(parts.hostname or '').lower()}:{parts.port or DEFAULT_PORTS.get(parts.scheme, 0)}"


def _ip_literal(host: str) -> bool:
    import ipaddress

    try:
        ipaddress.ip_address(host.strip("[]"))
        return True
    except ValueError:
        return False


def _spec(spec: dict[str, Any]) -> tuple[str, int, int]:
    url = spec.get("url")
    width = spec.get("width", WIDTH)
    max_height = spec.get("max_height", MAX_HEIGHT)
    if not isinstance(url, str) or not 1 <= len(url) <= 2048:
        raise CaptureError(NOT_ALLOWED)
    if width != WIDTH or not isinstance(max_height, int) or not 200 <= max_height <= MAX_HEIGHT:
        raise ValueError("Invalid capture spec")
    return url, width, max_height


async def capture_async(spec: dict[str, Any], guard: Guard | None = None, *,
                        executable_path: str | None = None) -> dict[str, Any]:
    """`{url, width, max_height}` → `{png: bytes, boxes: dict}`. Raises `CaptureError`."""
    from playwright.async_api import Error as PlaywrightError
    from playwright.async_api import async_playwright

    url, width, max_height = _spec(spec)
    guard = guard or Guard()
    check_url(url, guard)
    started = time.monotonic()

    async with GuardProxy(guard) as proxy, async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            proxy={"server": proxy.url},
            args=_LAUNCH_ARGS,
            executable_path=executable_path or os.environ.get("OPENCMO_CAPTURE_CHROMIUM") or None,
        )
        try:
            context = await browser.new_context(
                viewport={"width": width, "height": 900},
                device_scale_factor=SCALE,
                accept_downloads=False,
                service_workers="block",
                permissions=[],
                locale="en-US",
                color_scheme="light",
                reduced_motion="reduce",
            )

            async def only_web(route: Any) -> None:
                if urlsplit(route.request.url).scheme in DEFAULT_PORTS:
                    await route.continue_()
                else:
                    await route.abort("blockedbyclient")

            await context.route("**/*", only_web)
            page = await context.new_page()
            page.on("dialog", lambda dialog: asyncio.ensure_future(dialog.dismiss()))
            page.on("popup", lambda popup: asyncio.ensure_future(popup.close()))
            try:
                response = await page.goto(url, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
            except PlaywrightError as exc:
                raise CaptureError(NOT_ALLOWED if guard.blocked else NOT_OPENED) from exc
            if response is None or response.status >= 400:
                # The proxy answers a refused plain-http hop (a redirect to a private address) 403.
                refused = response is not None and _hop(response.url) in guard.blocked
                raise CaptureError(NOT_ALLOWED if refused else NOT_OPENED)
            if urlsplit(page.url).scheme not in DEFAULT_PORTS:
                raise CaptureError(NOT_ALLOWED)
            remaining = max(0.5, NAVIGATION_TIMEOUT_MS / 1000 - (time.monotonic() - started))
            try:
                await page.wait_for_load_state("load", timeout=remaining * 1000)
            except PlaywrightError:
                pass  # a slow tracker never finishing is no reason to refuse the page
            await _scroll_through(page, max_height)
            await page.wait_for_timeout(SETTLE_SECONDS * 1000)
            full = await page.evaluate("() => Math.ceil(document.documentElement.scrollHeight)")
            height = max(1, min(int(full or 1), max_height))
            png = await page.screenshot(
                type="png", full_page=True, clip={"x": 0, "y": 0, "width": width, "height": height},
                animations="disabled", timeout=30_000,
            )
            data = await page.evaluate(_RUNS_JS, [MAX_RUNS, height])
            final_url = page.url
        except PlaywrightError as exc:
            log.warning("Capture of %s failed: %s", url, str(exc)[:300])
            raise CaptureError(NOT_OPENED) from exc
        finally:
            await browser.close()

    if len(png) > MAX_PNG_BYTES:
        raise CaptureError(TOO_LARGE)
    boxes = {
        "url": final_url,
        "title": str(data.get("title") or "")[:300],
        "width": width,
        "height": height,
        "scale": SCALE,
        "runs": data.get("runs") or [],
    }
    log.info("Captured %s: %dx%d, %d runs, %d bytes, %.1fs",
             final_url, width, height, len(boxes["runs"]), len(png), time.monotonic() - started)
    return {"png": png, "boxes": boxes}


async def _scroll_through(page: Any, max_height: int) -> None:
    """Scroll down once so lazy images load, then back to the top for the screenshot."""
    deadline = time.monotonic() + SCROLL_SECONDS
    y = 0
    while y < max_height and time.monotonic() < deadline:
        y += 800
        await page.evaluate("(y) => window.scrollTo(0, y)", y)
        await page.wait_for_timeout(120)
        if y >= await page.evaluate("() => document.documentElement.scrollHeight"):
            break
    await page.evaluate("() => window.scrollTo(0, 0)")


def capture(spec: dict[str, Any], guard: Guard | None = None, **kwargs: Any) -> dict[str, Any]:
    """Synchronous entry point (Modal function, worker in local mode, tests)."""
    return asyncio.run(capture_async(spec, guard, **kwargs))
