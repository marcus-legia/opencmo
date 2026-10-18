"""Which addresses a page capture may reach (docs/style-skills-build.md, C3).

A captured page runs arbitrary JavaScript and can ask for anything: the cloud metadata service,
a database on the private network, the worker's own ports. Every connection the browser makes
goes through `guard.Guard`, which applies these rules to the IP it is about to connect to.

Same rules as `apps/web/lib/net/address.ts`, plus what Python's `ipaddress` knows is not globally
reachable, plus IPv4 hidden inside IPv6 (mapped, 6to4, Teredo, NAT64). Both sides read their cases
from `packages/contracts/private-addresses.json` (`tests/test_addresses.py`).
"""

from __future__ import annotations

import ipaddress
import re
import socket

#: The only ports a public page is captured on; anything else is refused.
DEFAULT_PORTS = {"http": 80, "https": 443}

_BLOCKED_NAMES = ("localhost", "local", "internal", "intranet", "lan", "home.arpa", "onion")


def private_address(address: str) -> bool:
    """True for every address a capture must never connect to; unparsable counts as private."""
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return True
    if isinstance(ip, ipaddress.IPv6Address):
        inner = ip.ipv4_mapped or ip.sixtofour or (ip.teredo[1] if ip.teredo else None)
        if inner is not None:
            return private_address(str(inner))
        # NAT64 (64:ff9b::/96) carries an IPv4 address in its last 32 bits.
        if ip in ipaddress.IPv6Network("64:ff9b::/96"):
            return private_address(str(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)))
    first, second = (ip.packed[0], ip.packed[1]) if ip.version == 4 else (0, 0)
    return (
        not ip.is_global
        or ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or (ip.version == 4 and (first == 0 or first >= 224 or (first == 100 and 64 <= second <= 127)))
    )


def blocked_name(host: str) -> bool:
    """Names that are never public, whatever DNS says: `localhost`, single labels, `.internal`…"""
    host = host.rstrip(".").lower()
    if not host or "." not in host:
        return True
    return any(host == name or host.endswith(f".{name}") for name in _BLOCKED_NAMES)


def literal_address(host: str) -> str | None:
    """The address a literal host stands for, or None when the host is a name.

    `urlsplit` keeps `2130706433`, `0x7f.1` and `017700000001` as they are, but the resolver reads
    them as 127.0.0.1 (`inet_aton`), so they must be judged as that address, never as a name.
    """
    host = host.strip("[]").rstrip(".")
    try:
        return str(ipaddress.ip_address(host.split("%", 1)[0]))
    except ValueError:
        pass
    if re.fullmatch(r"[0-9a-fA-FxX.]+", host) and re.match(r"[0-9]", host):
        try:
            return socket.inet_ntoa(socket.inet_aton(host))
        except OSError:
            return "0.0.0.0"  # a number the resolver would still try to read; never public
    return None


def blocked_host(host: str) -> bool:
    """True when a URL host is refused without DNS: a private literal address or a never-public name."""
    address = literal_address(host)
    return private_address(address) if address is not None else blocked_name(host)
