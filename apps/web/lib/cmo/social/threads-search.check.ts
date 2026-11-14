/**
 * The Threads finder (Sales finder A3) on real answers saved 2026-11-14, with no network.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/social/threads-search.check.ts
 */
import assert from "node:assert/strict";

import google from "./fixtures/scrapecreators/google-threads.json";
import post from "./fixtures/scrapecreators/threads-post.json";
import { ScBudget } from "./scrapecreators";
import { searchThreadsConversations, threadsCandidates } from "./threads-search";

function stub(answers: Record<string, () => { status: number; body: unknown }>): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    asked.push(path);
    const answer = answers[path]?.() ?? { status: 500, body: null };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return asked;
}

async function main() {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  process.env.SCRAPECREATORS_API_KEY = "sc-test";
  delete process.env.OPENCMO_AGENT_FAKE;
  // The saved post was taken 2026-11-08: pin "now" inside its 30 days.
  Date.now = () => Date.parse("2026-11-14T12:00:00Z");
  try {
    // Review focus 1 and 5: a tag page or a profile is not a post; one post under both domains and a slug is one.
    const kept = threadsCandidates([
      { url: "https://www.threads.com/tag/RingCentral", title: "tag", description: "" },
      { url: "https://www.threads.com/@maker", title: "profile", description: "" },
      { url: "https://www.threads.net/@maker/post/Abc123?xmt=1", title: "post", description: "" },
      { url: "https://www.threads.com/@maker/post/Abc123/some-words-here/", title: "same post", description: "" },
    ]);
    assert.deepEqual(kept.map((c) => c.url), ["https://www.threads.com/@maker/post/Abc123"]);

    const answers = { "/v1/google/search": () => ({ status: 200, body: google.body }), "/v1/threads/post": () => ({ status: 200, body: post.body }) };

    // The real answers: one post found and read, with its replies under it.
    let asked = stub(answers);
    const found = await searchThreadsConversations("invoicing clients", new ScBudget(10));
    assert.deepEqual(asked, ["/v1/google/search", "/v1/threads/post"], "the tag pages in the results are not read");
    assert.equal(found.length, 1);
    const t = found[0]!;
    assert.equal(t.platform, "threads");
    assert.match(t.url, /^https:\/\/www\.threads\.com\/@[^/]+\/post\/[A-Za-z0-9_-]+$/);
    assert.equal(t.community, "Threads");
    assert.match(t.text, /^Biggest flex\?/);
    assert.match(t.text, /\n— /, "replies follow the post");
    assert.ok(t.postedAt && t.postedAt.startsWith("2026-11-"));
    assert.ok(t.title.length > 0 && t.title.length <= 120);
    // Review A4: the trimmed answer has no reply count; the replies it carries are the count, never 0.
    assert.equal(t.comments, (post.body as { comments: unknown[] }).comments.length);
    assert.ok(t.comments > 0);

    // readPosts 0: Google only, and the post keeps Google's words.
    asked = stub(answers);
    const bare = await searchThreadsConversations("invoicing clients", new ScBudget(10), { readPosts: 0 });
    assert.deepEqual(asked, ["/v1/google/search"]);
    assert.equal(bare.length, 1);
    assert.equal(bare[0]!.postedAt, null);

    // Review focus 2: a read that fails keeps Google's words; a budget of one never throws.
    stub({ ...answers, "/v1/threads/post": () => ({ status: 404, body: null }) });
    assert.equal((await searchThreadsConversations("invoicing clients", new ScBudget(10))).length, 1);
    asked = stub(answers);
    assert.equal((await searchThreadsConversations("invoicing clients", new ScBudget(1))).length, 1);
    assert.deepEqual(asked, ["/v1/google/search"]);

    // An old post (more than 30 days) is dropped once its time is known.
    Date.now = () => Date.parse("2027-02-01T00:00:00Z");
    stub(answers);
    assert.deepEqual(await searchThreadsConversations("invoicing clients", new ScBudget(10)), []);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    delete process.env.SCRAPECREATORS_API_KEY;
  }
  console.log("threads-search.check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
