"""Which addresses a page capture may reach (docs/style-skills-build.md, C3).

A captured page runs arbitrary JavaScript and can ask for anything: the cloud metadata service,
a database on the private network, the worker's own ports. Every connection the browser makes
goes through `guard.Guard`, which applies these rules to the IP it is about to connect to.

Same rules as `apps/web/lib/cmo/site.ts` (`privateAddress`), plus what Python's `ipaddress`
knows is not globally reachable, plus IPv4 hidden inside IPv6 (mapped, 6to4, Teredo).
"""

from __future__ import annotations

import ipaddress

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
