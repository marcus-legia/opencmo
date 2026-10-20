"""The shared address cases (`packages/contracts/private-addresses.json`), worker side.

`apps/web/lib/net/address.check.ts` reads the same file, so the two guards cannot disagree on any
case in it.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from opencmo.capture.addresses import blocked_host, literal_address, private_address

CASES = json.loads(
    (Path(__file__).resolve().parents[3] / "packages/contracts/private-addresses.json").read_text()
)


def test_the_fixture_has_both_kinds() -> None:
    assert len(CASES) >= 25
    assert any(case["blocked"] for case in CASES) and any(not case["blocked"] for case in CASES)


@pytest.mark.parametrize("case", CASES, ids=[case["input"] for case in CASES])
def test_shared_case(case: dict) -> None:
    host = urlsplit(f"https://{case['input']}/v.mp4").hostname
    assert host is not None
    assert blocked_host(host) is case["blocked"], case["why"]
    address = literal_address(host)
    if address is not None:
        assert private_address(address) is case["blocked"], case["why"]


@pytest.mark.parametrize(("host", "address"), [
    ("2130706433", "127.0.0.1"), ("0x7f.1", "127.0.0.1"), ("017700000001", "127.0.0.1"),
    ("[::1]", "::1"), ("8.8.8.8", "8.8.8.8"), ("example.com", None), ("0xdead.example", None),
])
def test_literal_address(host: str, address: str | None) -> None:
    assert literal_address(host) == address


# ---- The worker's link check reads the same cases (no DNS: names resolve to a public address).
