/**
 * Runs for real, not only at typecheck.
 *
 *     cd apps/web && npx tsx lib/auth/next.check.ts
 *
 * The open redirect after sign-in (security fixes plan, fix 3). The "before" case keeps the old
 * origin-only expression from `auth/callback/route.ts` so the check proves it was exploitable.
 */
import assert from "node:assert/strict";

import { safeNext } from "./next";

const PARSE_BASE = "http://redirect.invalid";
function before(next: string): string {
  let target = new URL(next, PARSE_BASE);
  if (target.origin !== PARSE_BASE) target = new URL("/app", PARSE_BASE);
  return `${target.pathname}${target.search}`;
}
assert.equal(before("/.//evil.example"), "//evil.example", "the old expression let a protocol-relative path through");

const blocked = [
  "/.//evil.example",
  "%2F.%2F%2Fevil.example",
  "/..//evil.example",
  "/%2e//evil.example",
  "/a/..//evil.example",
  "/./\\evil.example",
  "\t//evil.example",
  "/%5Cevil.example",
  "//evil.example",
  "https://evil.example",
  "/%E0%A4%A",
];
for (const input of blocked) assert.equal(safeNext(input), "/app", JSON.stringify(input));

for (const input of ["/app/editor?x=1", "/oauth/consent?authorization_id=abc"]) assert.equal(safeNext(input), input, input);
assert.equal(safeNext(null), "/app");
assert.equal(safeNext(""), "/app");

console.log(`safeNext: ${blocked.length} unsafe inputs → /app, internal paths kept.`);
