/**
 * The Facebook group finder (Sales finder A3) on real answers saved 2026-11-14, with no network.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/social/facebook.check.ts
 */
import assert from "node:assert/strict";

import google from "./fixtures/scrapecreators/google-facebook-groups.json";
import post from "./fixtures/scrapecreators/facebook-post.json";
import { facebookCandidates, groupName, searchFacebookGroups } from "./facebook";
import { ScBudget } from "./scrapecreators";

type Answer = { status: number; body: unknown };

/** `fetch` answering by path; records every path asked. */
function stub(answers: Record<string, () => Answer>): string[] {
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
  process.env.SCRAPECREATORS_API_KEY = "sc-test";
  delete process.env.OPENCMO_AGENT_FAKE;
  // The saved post is from 2026-11-06: pin "now" inside its 30 days.
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-11-14T12:00:00Z");
  try {
    // Review focus 1: only a group post's own page is a candidate.
    const kept = facebookCandidates([
      { url: "https://www.facebook.com/groups/123/", title: "Group home", description: "" },
      { url: "https://www.facebook.com/groups/123/about", title: "About", description: "" },
      { url: "https://www.facebook.com/someone", title: "A profile", description: "" },
      { url: "https://www.facebook.com/login.php?next=x", title: "Log in", description: "" },
      { url: "https://m.facebook.com/groups/123/posts/456/?__cft__=x", title: "Need help | Freelancers | Facebook", description: "" },
      { url: "https://www.facebook.com/groups/123/posts/456/", title: "Same post again", description: "" },
    ]);
    assert.deepEqual(kept.map((c) => c.url), ["https://www.facebook.com/groups/123/posts/456"]);
    // Review A4: Google's titles end in " - Facebook" and name no group; a vanity group name in the link is the best
    // there is, a numeric id is not a name.
    assert.equal(groupName("https://www.facebook.com/groups/vaworkersph/posts/1"), "vaworkersph");
    assert.equal(groupName("https://www.facebook.com/groups/1753756208440623/posts/1"), "Facebook group");

    const answers = { "/v1/google/search": () => ({ status: 200, body: google.body }), "/v1/facebook/post": () => ({ status: 200, body: post.body }) };

    // The real answers: the read post's own words, its time and its comment count.
    let asked = stub(answers);
    const threads = await searchFacebookGroups("finding clients", new ScBudget(10), { readPosts: 1 });
    assert.equal(asked.length, 2, "one Google lookup, one post read");
    assert.ok(threads.length >= 1);
    const first = threads[0]!;
    assert.equal(first.platform, "facebook");
    assert.match(first.url, /^https:\/\/www\.facebook\.com\/groups\/[^/]+\/posts\/\d+$/);
    assert.match(first.text, /hard time finding clients/);
    assert.equal(first.comments, 36);
    assert.equal(first.postedAt, "2026-11-06T00:33:28.000Z");
    assert.equal(asked.filter((p) => p === "/v1/google/search").length, 1);
    // The query asked Google for last month's group posts.
    globalThis.fetch = (async (input: string) => {
      const url = new URL(input);
      assert.equal(url.searchParams.get("date_posted"), "last-month");
      assert.match(url.searchParams.get("query") ?? "", /^site:facebook\.com\/groups /);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;
    assert.deepEqual(await searchFacebookGroups("x", new ScBudget(10)), []);

    // readPosts bounds the lookups: 0 reads nothing past Google, 4 reads at most four posts.
    asked = stub(answers);
    await searchFacebookGroups("finding clients", new ScBudget(10), { readPosts: 0 });
    assert.deepEqual(asked, ["/v1/google/search"]);
    asked = stub(answers);
    await searchFacebookGroups("finding clients", new ScBudget(10), { readPosts: 4 });
    assert.ok(asked.length <= 5);

    // Review focus 2: a post that cannot be read keeps Google's words, and the finder still answers.
    stub({ ...answers, "/v1/facebook/post": () => ({ status: 500, body: null }) });
    const unread = await searchFacebookGroups("finding clients", new ScBudget(10), { readPosts: 4 });
    assert.equal(unread.length, google.body.results.filter((r) => /\/groups\/[^/]+\/posts\//.test(r.url)).length);
    assert.ok(unread.every((t) => t.text.length > 0 && t.comments === 0 && t.postedAt === null));
    assert.ok(unread.every((t) => !/facebook$/i.test(t.title)), "Google's \" - Facebook\" suffix is not part of the title");

    // A budget of one: Google only, no error.
    asked = stub(answers);
    const tight = await searchFacebookGroups("finding clients", new ScBudget(1), { readPosts: 4 });
    assert.deepEqual(asked, ["/v1/google/search"]);
    assert.ok(tight.length >= 1);

    // Review A4: posts the founder has already seen are not paid for; the reads go to the next ones.
    asked = stub(answers);
    const all = facebookCandidates(google.body.results);
    const skipped = await searchFacebookGroups("finding clients", new ScBudget(10), { readPosts: 1, skip: (url) => url === all[0]!.url });
    assert.ok(!skipped.some((t) => t.url === all[0]!.url), "a seen post is not returned");
    assert.equal(asked.filter((p) => p === "/v1/facebook/post").length, 1, "the one read goes to an unseen post");

    // Review A4: out of lookup credits stops the step instead of trying every post again.
    stub({ ...answers, "/v1/facebook/post": () => ({ status: 402, body: null }) });
    await assert.rejects(searchFacebookGroups("finding clients", new ScBudget(10)), /out of lookup credits/);

    // A refused key is not "no posts": it stops the scan's Facebook step.
    stub({ ...answers, "/v1/facebook/post": () => ({ status: 401, body: null }) });
    await assert.rejects(searchFacebookGroups("finding clients", new ScBudget(10)), /not set up/);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    delete process.env.SCRAPECREATORS_API_KEY;
  }
  console.log("facebook.check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
