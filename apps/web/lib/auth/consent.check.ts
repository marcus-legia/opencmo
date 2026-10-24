/**
 * Runs for real, not only at typecheck.
 *
 *     cd apps/web && npx tsx lib/auth/consent.check.ts
 *
 * The OAuth redirect host allowlist (security fixes plan, fix 6).
 */
import assert from "node:assert/strict";

import { allowedRedirectHost, isLoopbackRedirect } from "./consent";

const env = {};
assert.equal(allowedRedirectHost("https://claude.ai/api/mcp/auth_callback", env), "claude.ai");
assert.equal(allowedRedirectHost("https://claude.com/api/mcp/auth_callback", env), "claude.com");
assert.equal(allowedRedirectHost("http://localhost:6274/oauth/callback", env), "localhost");
assert.equal(allowedRedirectHost("http://127.0.0.1:33418/callback", env), "127.0.0.1");
for (const uri of [
  "https://evil.example/cb",
  "https://claude.ai.evil.example/cb",
  "https://evil.claude.ai/cb",
  "https://claude.ai@evil.example/cb",
  "claude.ai/cb",
  "",
  "http://claude.ai/cb",
  "https://localhost:6274/oauth/callback",
  "ftp://127.0.0.1/cb",
  "javascript://localhost/%0aalert(1)",
]) {
  assert.equal(allowedRedirectHost(uri, env), null, uri);
}
assert.equal(allowedRedirectHost("https://CLAUDE.AI/cb", env), "claude.ai", "hostnames compare case-insensitively");
assert.equal(allowedRedirectHost("https://cursor.example/cb", { OPENCMO_OAUTH_REDIRECT_HOSTS: "cursor.example" }), "cursor.example");
assert.equal(allowedRedirectHost("https://claude.ai/cb", { OPENCMO_OAUTH_REDIRECT_HOSTS: "cursor.example" }), null);

assert.equal(isLoopbackRedirect("http://127.0.0.1:33418/callback"), true);
assert.equal(isLoopbackRedirect("https://claude.ai/cb"), false);

console.log("OAuth redirect hosts: allowlist holds.");
