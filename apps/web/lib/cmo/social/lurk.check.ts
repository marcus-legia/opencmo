/**
 * The LurkAPI trial (2026-11-15): which provider each path goes to, and how Lurk's error codes read. No network.
 *
 *   cd apps/web && npx tsx lib/cmo/social/lurk.check.ts
 */
import assert from "node:assert/strict";

import { scGet, socialReaderReady, socialRoute, SocialReadError } from "./scrapecreators";

async function main() {
  const realFetch = globalThis.fetch;
  delete process.env.OPENCMO_AGENT_FAKE;
  delete process.env.SCRAPECREATORS_API_KEY;
  delete process.env.SCRAPE_CREATORS_API_KEY;
  delete process.env.LURK_API_KEY;
  try {
    // No key at all: nothing to read with.
    assert.equal(socialRoute("/v1/reddit/search", { query: "q" }), null);
    assert.equal(socialReaderReady(), false);

    // ScrapeCreators only: unchanged, with `trim`.
    process.env.SCRAPECREATORS_API_KEY = "sc";
    const sc = socialRoute("/v1/reddit/search", { query: "q" });
    assert.equal(sc?.provider, "scrapecreators");
    assert.equal(sc?.url, "https://api.scrapecreators.com/v1/reddit/search?query=q&trim=true");

    // Both keys: Lurk for what it serves, without ScrapeCreators-only params; Google search stays on ScrapeCreators.
    process.env.LURK_API_KEY = "lk";
    const lurk = socialRoute("/v1/threads/post", { url: "https://threads.com/x", cache_max_age: "7d" });
    assert.equal(lurk?.provider, "lurk");
    assert.equal(lurk?.key, "lk");
    assert.equal(lurk?.url, "https://api.lurkapi.com/v1/threads/post?url=https%3A%2F%2Fthreads.com%2Fx");
    assert.equal(socialRoute("/v1/credit/balance", {})?.url, "https://api.lurkapi.com/v1/account/credit-balance?");
    assert.equal(socialRoute("/v1/google/search", { query: "q" })?.provider, "scrapecreators");
    assert.equal(socialRoute("/v1/twitter/tweet/transcript", { url: "u" })?.provider, "scrapecreators");
    assert.equal(socialRoute("/v1/facebook/post", { url: "https://www.facebook.com/groups/1/posts/2/" })?.provider, "scrapecreators", "Lurk refuses group posts");
    assert.equal(socialRoute("/v1/threads/post", { url: "u" })?.provider, "lurk");

    // Lurk only: Google search has nowhere to go.
    delete process.env.SCRAPECREATORS_API_KEY;
    assert.equal(socialReaderReady(), true);
    assert.equal(socialRoute("/v1/google/search", { query: "q" }), null);
    await assert.rejects(scGet("/v1/google/search", { query: "q" }), (e: unknown) => e instanceof SocialReadError && e.kind === "setup");

    // Lurk's answers by code.
    const answer = (status: number, body: unknown) => {
      globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
    };
    const kindOf = async (status: number, code: string) => {
      answer(status, { success: false, code, credits_charged: 0 });
      try {
        await scGet("/v1/reddit/search", { query: "q" });
        return "ok";
      } catch (e) {
        return e instanceof SocialReadError ? e.kind : "other";
      }
    };
    answer(200, { success: true, credits_charged: 1, posts: [{ id: "a" }] });
    assert.deepEqual(await scGet("/v1/reddit/search", { query: "q" }), { success: true, credits_charged: 1, posts: [{ id: "a" }] });
    assert.equal(await kindOf(404, "not_found"), "not_found");
    assert.equal(await kindOf(403, "not_public"), "not_found", "a private post is not a key problem on Lurk");
    assert.equal(await kindOf(404, "transcript_unavailable"), "not_found");
    assert.equal(await kindOf(401, "invalid_api_key"), "setup");
    assert.equal(await kindOf(403, "account_suspended"), "setup");
    assert.equal(await kindOf(402, "insufficient_credits"), "credits");
    assert.equal(await kindOf(429, "rate_limited"), "busy");
    assert.equal(await kindOf(502, "upstream_error"), "unavailable");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.LURK_API_KEY;
    delete process.env.SCRAPECREATORS_API_KEY;
  }
  console.log("lurk.check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
