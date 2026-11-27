/**
 * The X News client (`client.ts`) on a recorded response and stubbed fetches, with no network.
 *
 *     cd apps/web && npx tsx lib/x/client.check.ts
 */
import assert from "node:assert/strict";

import recorded from "./fixtures/news-search.json";
import { parseNewsSearch, searchNews } from "./client";

async function main() {
  const stories = parseNewsSearch(recorded);
  assert.equal(stories.length, 6);
  for (const s of stories) {
    assert.match(s.storyId, /^[0-9]{1,19}$/);
    assert.ok(s.name.length >= 1 && s.name.length <= 120);
    assert.ok(s.summary.length <= 1000 && s.hook.length <= 400);
    assert.ok(s.postIds.length <= 10);
  }
  assert.deepEqual(stories[0]!.postIds, ["1994000000000100001", "1994000000000100002", "1994000000000100003"]);
  assert.equal(stories[3]!.postIds.length, 0, "a story with no cluster posts keeps an empty list");

  // Outside text: a bad id, no name, a duplicated or malformed post id, smuggled invisible characters, long text.
  const odd = parseNewsSearch({
    data: [
      { id: "../1", name: "Bad id" },
      { id: "2", name: "   " },
      { id: "3", name: "Zero​width\nname", summary: "x".repeat(2000), cluster_posts_results: [{ post_id: "9" }, { post_id: "9" }, { post_id: "abc" }, null] },
      null,
    ],
  });
  assert.equal(odd.length, 1);
  assert.equal(odd[0]!.name, "Zerowidth name");
  assert.equal(odd[0]!.summary.length, 1000);
  assert.deepEqual(odd[0]!.postIds, ["9"]);
  // A cut never splits an emoji: Postgres refuses a lone surrogate, and counts code points as this does.
  const emoji = parseNewsSearch({ data: [{ id: "5", name: `${"a".repeat(119)}🚀🚀` }] })[0]!.name;
  assert.equal(Array.from(emoji).length, 120);
  assert.ok(emoji.endsWith("🚀") && !/[\ud800-\udbff]$/.test(emoji));
  assert.deepEqual(parseNewsSearch(null), []);
  assert.deepEqual(parseNewsSearch({ data: "nope" }), []);

  // The request: app-only bearer, the fields the snapshot stores, bounded parameters.
  const prev = process.env.X_BEARER_TOKEN;
  process.env.X_BEARER_TOKEN = "test-token";
  try {
    let seen: { url: string; auth: string | null } | null = null;
    const ok = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(input), auth: new Headers(init?.headers).get("authorization") };
      return new Response(JSON.stringify(recorded), { status: 200 });
    }) as typeof fetch;
    const found = await searchNews("  AI  ", { maxAgeHours: 9999, max: 500, fetchImpl: ok });
    assert.equal(found.called, true);
    assert.equal(found.stories.length, 6);
    const url = new URL(seen!.url);
    assert.equal(url.origin + url.pathname, "https://api.x.com/2/news/search");
    assert.equal(url.searchParams.get("query"), "AI");
    assert.equal(url.searchParams.get("max_age_hours"), "720");
    assert.equal(url.searchParams.get("max_results"), "100");
    assert.match(url.searchParams.get("news.fields")!, /cluster_posts_results/);
    assert.equal(seen!.auth, "Bearer test-token");

    // A 429 or a 5xx gives no stories and does not throw; it still counts as a call.
    for (const status of [429, 503]) {
      const failed = await searchNews("AI", { fetchImpl: (async () => new Response("{}", { status })) as typeof fetch });
      assert.deepEqual([failed.stories.length, failed.called, failed.status], [0, true, status]);
    }
    const thrown = await searchNews("AI", { fetchImpl: (async () => { throw new Error("network"); }) as typeof fetch });
    assert.deepEqual([thrown.stories.length, thrown.called], [0, true]);
    const bad = await searchNews("AI", { fetchImpl: (async () => new Response("not json", { status: 200 })) as typeof fetch });
    assert.equal(bad.stories.length, 0, "a body that does not parse gives no stories");

    // An empty query sends nothing.
    const empty = await searchNews("   ", { fetchImpl: (async () => { throw new Error("must not be called"); }) as typeof fetch });
    assert.equal(empty.called, false);

    // No key and no fake: nothing is sent.
    delete process.env.X_BEARER_TOKEN;
    const prevFake = process.env.OPENCMO_AGENT_FAKE;
    delete process.env.OPENCMO_AGENT_FAKE;
    const none = await searchNews("AI", { fetchImpl: (async () => { throw new Error("must not be called"); }) as typeof fetch });
    assert.deepEqual([none.stories.length, none.called], [0, false]);
    // The fake serves the recorded stories without a request.
    process.env.OPENCMO_AGENT_FAKE = "1";
    const fake = await searchNews("anything", { max: 3 });
    assert.deepEqual([fake.stories.length, fake.called], [3, false]);
    if (prevFake === undefined) delete process.env.OPENCMO_AGENT_FAKE;
    else process.env.OPENCMO_AGENT_FAKE = prevFake;
  } finally {
    if (prev === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = prev;
  }
  console.log("x news client: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
