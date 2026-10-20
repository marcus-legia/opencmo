"""A forward proxy that every connection of a page capture goes through.

Why a proxy and not only Playwright's request interception: interception sees URLs, not
addresses. Checking a host name and letting Chromium resolve it again is a race (DNS rebinding:
public answer for the check, `169.254.169.254` for the connection), and redirects, WebSockets and
preconnects do not all pass the same hook. Here the proxy resolves each host once, refuses unless
every answer is public, and connects to the address it checked. Chromium is started with this
proxy for everything, loopback included (Playwright adds `<-loopback>` to the bypass list).

HTTPS and WebSockets arrive as CONNECT tunnels; plain HTTP as absolute-form requests, served one
per connection (`Connection: close`) so a kept-alive proxy connection can never carry a request
for a second, unchecked host.

Synchronous callers use the same proxy when the worker has no outbound proxy of its own:
`shared_proxy_url()` runs one for the whole process on a thread.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import socket
import threading
from dataclasses import dataclass, field
from typing import Self
from urllib.parse import urlsplit

from opencmo.capture.addresses import DEFAULT_PORTS, blocked_name, private_address

log = logging.getLogger(__name__)

#: A request head larger than this is not a browser talking to a proxy.
MAX_HEAD = 64 * 1024
#: Refusals kept for errors and tests; the shared proxy lives as long as the worker process.
MAX_BLOCKED = 100
#: Connections the page may hold open at once; a page that opens more waits.
MAX_CONNECTIONS = 64
CONNECT_TIMEOUT = 10.0
_HOP_HEADERS = {"connection", "proxy-connection", "keep-alive", "proxy-authorization", "te", "upgrade"}


class Refused(Exception):
    """This host or port may not be reached."""


@dataclass
class Guard:
    """The address policy plus a record of what it refused (for errors and tests).

    `allow` is for tests only: exact `(host, port)` pairs reachable even though they are local.
    The worker never sets it; nothing in a task's payload reaches it.
    """

    allow: frozenset[tuple[str, int]] = frozenset()
    blocked: list[str] = field(default_factory=list)

    async def open(self, host: str, port: int) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        host = host.strip("[]").rstrip(".").lower()
        if (host, port) in self.allow:
            return await asyncio.wait_for(asyncio.open_connection(host, port), CONNECT_TIMEOUT)
        if port not in DEFAULT_PORTS.values():
            self._refuse(host, port, "port")
        try:
            literal = socket.inet_pton(socket.AF_INET6 if ":" in host else socket.AF_INET, host) and True
        except OSError:
            literal = False
        if not literal and blocked_name(host):
            self._refuse(host, port, "name")
        loop = asyncio.get_running_loop()
        try:
            infos = await asyncio.wait_for(
                loop.getaddrinfo(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP), CONNECT_TIMEOUT
            )
        except (TimeoutError, OSError) as exc:
            raise Refused(f"{host}: no address") from exc
        addresses = [info[4][0] for info in infos]
        if not addresses or any(private_address(address) for address in addresses):
            self._refuse(host, port, "private address")
        last: Exception | None = None
        for address in dict.fromkeys(addresses):
            try:
                return await asyncio.wait_for(asyncio.open_connection(address, port), CONNECT_TIMEOUT)
            except (TimeoutError, OSError) as exc:
                last = exc
        raise Refused(f"{host}: could not connect") from last

    def _refuse(self, host: str, port: int, why: str) -> None:
        self.blocked.append(f"{host}:{port}")
        del self.blocked[:-MAX_BLOCKED]
        log.info("Capture refused %s:%s (%s)", host, port, why)
        raise Refused(f"{host}:{port} {why}")


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        with contextlib.suppress(Exception):
            writer.close()


async def _relay(client: tuple[asyncio.StreamReader, asyncio.StreamWriter],
                 upstream: tuple[asyncio.StreamReader, asyncio.StreamWriter]) -> None:
    await asyncio.gather(_pipe(client[0], upstream[1]), _pipe(upstream[0], client[1]))


def _refusal(writer: asyncio.StreamWriter) -> None:
    writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")


class GuardProxy:
    """`async with GuardProxy(guard) as proxy:` → `proxy.url` for Chromium's `--proxy-server`."""

    def __init__(self, guard: Guard) -> None:
        self.guard = guard
        self._server: asyncio.base_events.Server | None = None
        self._slots = asyncio.Semaphore(MAX_CONNECTIONS)
        self.url = ""

    async def __aenter__(self) -> Self:
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        port = self._server.sockets[0].getsockname()[1]
        self.url = f"http://127.0.0.1:{port}"
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self._server is not None:
            self._server.close()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._server.wait_closed(), 2)

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        async with self._slots:
            try:
                await self._handle(reader, writer)
            except Exception:
                log.debug("Capture proxy connection failed", exc_info=True)
            finally:
                with contextlib.suppress(Exception):
                    writer.close()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            return
        if len(head) > MAX_HEAD:
            return
        lines = head.decode("latin-1").split("\r\n")
        method, _, rest = lines[0].partition(" ")
        target, _, version = rest.partition(" ")
        if method.upper() == "CONNECT":
            host, _, port = target.rpartition(":")
            try:
                upstream = await self.guard.open(host, int(port))
            except (Refused, ValueError):
                _refusal(writer)
                await writer.drain()
                return
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
            await _relay((reader, writer), upstream)
            return
        url = urlsplit(target)
        if url.scheme != "http" or not url.hostname:
            _refusal(writer)
            await writer.drain()
            return
        try:
            upstream = await self.guard.open(url.hostname, url.port or 80)
        except Refused:
            _refusal(writer)
            await writer.drain()
            return
        path = url.path or "/"
        if url.query:
            path = f"{path}?{url.query}"
        headers = [line for line in lines[1:] if line and line.split(":", 1)[0].strip().lower() not in _HOP_HEADERS]
        out = "\r\n".join([f"{method} {path} {version or 'HTTP/1.1'}", *headers, "Connection: close", "", ""])
        upstream[1].write(out.encode("latin-1"))
        await upstream[1].drain()
        await _relay((reader, writer), upstream)


class GuardProxyThread:
    """A `GuardProxy` on its own event-loop thread, for synchronous callers.

    `with GuardProxyThread(guard) as proxy:` → `proxy.url`.
    """

    def __init__(self, guard: Guard) -> None:
        self.guard = guard
        self.url = ""
        self._loop: asyncio.AbstractEventLoop | None = None
        self._proxy: GuardProxy | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> Self:
        ready = threading.Event()
        failure: list[BaseException] = []

        def run() -> None:
            loop = asyncio.new_event_loop()
            self._loop = loop
            try:
                self._proxy = loop.run_until_complete(GuardProxy(self.guard).__aenter__())
                self.url = self._proxy.url
            except BaseException as exc:  # noqa: BLE001 - surfaced to the caller below
                failure.append(exc)
                ready.set()
                return
            ready.set()
            loop.run_forever()
            loop.run_until_complete(self._proxy.__aexit__(None, None, None))
            loop.close()

        self._thread = threading.Thread(target=run, name="guard-proxy", daemon=True)
        self._thread.start()
        if not ready.wait(10) or failure or not self.url:
            raise RuntimeError("The address guard proxy did not start") from (failure[0] if failure else None)
        return self

    def stop(self) -> None:
        if self._loop is not None and self._thread is not None:
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._thread.join(5)

    def __enter__(self) -> Self:
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.stop()


_shared: GuardProxyThread | None = None
_shared_lock = threading.Lock()


def shared_proxy_url() -> str:
    """The process-wide guard proxy, started on first use; no `allow`, so no exceptions."""
    global _shared
    with _shared_lock:
        if _shared is None or _shared._thread is None or not _shared._thread.is_alive():
            _shared = GuardProxyThread(Guard()).start()
        return _shared.url
