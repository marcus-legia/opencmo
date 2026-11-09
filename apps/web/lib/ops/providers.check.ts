/** Provider rows (cmo-review-2 S3.1): a wrong key shows as invalid, a test key in production is called out, no key leaks. */
import assert from "node:assert/strict";

import { clearHealth, markDown } from "@/lib/llm-health";
import { CACHE_MS, clearProviderCache, providerRows } from "./providers";

type Seen = { url: string; init?: RequestInit };

/** Answers 401 to the key "x", 200 to any other; records each call. */
function fakeProviders(answer: (url: string, key: string) => { status: number; body?: string } = (_url, key) => ({ status: key === "x" ? 401 : 200 })) {
  const seen: Seen[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    const headers = new Headers(init?.headers);
    const key = headers.get("x-api-key") ?? headers.get("xi-api-key") ?? headers.get("authorization")?.replace(/^(Key|Bearer) /, "") ?? "";
    const { status, body = "{}" } = answer(url, key);
    return new Response(body, { status });
  }) as typeof fetch;
  return { seen, fetcher };
}

const byId = async (env: Record<string, string>, fetcher: typeof fetch, now = 0) => {
  const rows = await providerRows({ env, fetcher, now });
  return Object.fromEntries(rows.map((row) => [row.id, row]));
};

async function main() {
  // Nothing set: every row says so, and no call goes out.
  clearProviderCache();
  {
    const { seen, fetcher } = fakeProviders();
    const rows = await byId({}, fetcher);
    for (const id of ["anthropic", "fal", "elevenlabs", "motion", "creem", "scrapecreators"]) assert.equal(rows[id]?.state, "unset", `${id} unset`);
    assert.equal(seen.length, 0, "an unset key is not checked");
  }

  // The S3.1 check: a key set to `x` shows "invalid key", for every provider with a live check.
  clearProviderCache();
  const bad = { ANTHROPIC_API_KEY: "x", FAL_KEY: "x", ELEVENLABS_API_KEY: "x", CREEM_API_KEY: "x", SCRAPECREATORS_API_KEY: "x" };
  {
    const { seen, fetcher } = fakeProviders();
    const rows = await byId(bad, fetcher);
    for (const id of ["anthropic", "fal", "elevenlabs", "creem", "scrapecreators"]) assert.equal(rows[id]?.state, "invalid", `${id}: x is invalid`);
    assert.equal(seen.length, 5);
    assert.ok(seen.some((call) => call.url === "https://api.anthropic.com/v1/models?limit=1"));
    assert.ok(seen.some((call) => call.url === "https://api.scrapecreators.com/v1/credit/balance"));
    assert.ok(seen.some((call) => call.url === "https://api.creem.io/v1/moderation/prompt" && call.init?.method === "POST"));
    assert.ok(!JSON.stringify(rows).includes('"x"'), "no key on the page");
  }

  // Cached: a reload within the window does not call again; a changed key checks only its own provider again.
  {
    const { seen, fetcher } = fakeProviders();
    await byId(bad, fetcher, 1_000);
    assert.equal(seen.length, 0, "cached");
    const good = { ...bad, ANTHROPIC_API_KEY: "sk-ant-good" };
    const rows = await byId(good, fetcher, 2_000);
    assert.equal(seen.length, 1, "a changed key checks its provider again, and only it");
    assert.equal(rows.anthropic?.state, "ok");
    await byId(good, fetcher, 2_000 + CACHE_MS + 1);
    assert.equal(seen.length, 6, "an old answer is checked again");
  }

  // Two page loads at once: one call per provider.
  clearProviderCache();
  {
    const { seen, fetcher } = fakeProviders();
    await Promise.all([byId({ CREEM_API_KEY: "ck" }, fetcher, 0), byId({ CREEM_API_KEY: "ck" }, fetcher, 0)]);
    assert.equal(seen.length, 1, "the check in flight is shared");
  }

  // A 2xx body is released, not left holding its connection.
  clearProviderCache();
  {
    let cancelled = 0;
    const fetcher = (async () => {
      const body = new ReadableStream({ cancel: () => void (cancelled += 1) });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    await byId({ SCRAPECREATORS_API_KEY: "k" }, fetcher, 0);
    assert.equal(cancelled, 1);
  }

  // fal's 403 (no Admin scope) and ElevenLabs' missing_permissions are known keys, not wrong ones.
  clearProviderCache();
  {
    const { fetcher } = fakeProviders((url) =>
      url.includes("fal.ai") ? { status: 403 } : url.includes("elevenlabs") ? { status: 401, body: '{"detail":{"status":"missing_permissions"}}' } : { status: 200 },
    );
    const rows = await byId({ FAL_KEY: "fk", ELEVENLABS_API_KEY: "ek" }, fetcher);
    assert.equal(rows.fal?.state, "ok");
    assert.equal(rows.elevenlabs?.state, "ok");
  }

  // A test Creem key in production: called out before any call; outside production it is checked on the sandbox.
  clearProviderCache();
  {
    const { seen, fetcher } = fakeProviders();
    const rows = await byId({ CREEM_API_KEY: "creem_test_abc", VERCEL_ENV: "production" }, fetcher);
    assert.equal(rows.creem?.state, "test_key");
    assert.equal(seen.length, 0);
    clearProviderCache();
    const dev = await byId({ CREEM_API_KEY: "creem_test_abc" }, fetcher);
    assert.equal(dev.creem?.state, "ok");
    assert.equal(seen[0]?.url, "https://test-api.creem.io/v1/moderation/prompt");
  }

  // Down, a timeout or a 5xx: "no answer", not "invalid".
  clearProviderCache();
  {
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    assert.equal((await byId({ SCRAPECREATORS_API_KEY: "k" }, down)).scrapecreators?.state, "unreachable");
    clearProviderCache();
    const { fetcher } = fakeProviders(() => ({ status: 503 }));
    assert.equal((await byId({ SCRAPECREATORS_API_KEY: "k" }, fetcher)).scrapecreators?.state, "unreachable");
  }

  // Motion has no live call: configured, unset, or `local` in production.
  clearProviderCache();
  {
    const { seen, fetcher } = fakeProviders();
    assert.equal((await byId({ MOTION_PREVIEW_URL: "https://a--opencmo-motion-preview.modal.run", MOTION_PREVIEW_TOKEN: "t" }, fetcher)).motion?.state, "ok");
    clearProviderCache();
    assert.equal((await byId({ OPENCMO_MOTION: "local", OPENCMO_ENV: "production" }, fetcher)).motion?.state, "test_key");
    assert.equal(seen.length, 0);
  }

  // A real Anthropic call that failed on the key since the last check wins over the cached "ok".
  clearProviderCache();
  clearHealth();
  {
    const { fetcher } = fakeProviders();
    assert.equal((await byId({ ANTHROPIC_API_KEY: "sk-ant-good" }, fetcher, 0)).anthropic?.state, "ok");
    markDown("anthropic", "account", "claude-sonnet", 10);
    assert.equal((await byId({ ANTHROPIC_API_KEY: "sk-ant-good" }, fetcher, 20)).anthropic?.state, "failing", "not called an invalid key: it may be the credit");
    clearHealth();
  }

  console.log("providers: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
