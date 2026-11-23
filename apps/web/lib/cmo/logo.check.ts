/**
 * Company logos: the host is a bare public name, and the type comes from the bytes, never from the upstream header.
 */
import assert from "node:assert/strict";

import { logoHost, logoSrc, rasterType } from "@/lib/cmo/logo";

assert.equal(logoHost("https://www.Buffer.com/pricing"), "buffer.com");
assert.equal(logoHost("ferreto.io"), "ferreto.io");
assert.equal(logoHost("127.0.0.1"), null);
assert.equal(logoHost("http://user@evil.com:8080/"), "evil.com");
assert.equal(logoHost("localhost"), null);
assert.equal(logoSrc(""), null);
assert.equal(logoSrc("syften.com"), "/api/logo?d=syften.com");

assert.equal(rasterType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
assert.equal(rasterType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
assert.equal(rasterType(new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01])), "image/x-icon");
assert.equal(rasterType(new TextEncoder().encode("<html><script>alert(1)</script>")), null);
assert.equal(rasterType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);

console.log("logo ok");
