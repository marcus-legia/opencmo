/**
 * The Composer's live checks (plan Task C1): each issue quotes an exact sentence of the post, the sub's verdict sets
 * how hard links and the product's name are flagged, a plain post passes, and a 3,000-character post is checked in
 * under 5 ms.
 *
 *     cd apps/web && npx tsx lib/composer/live-check.check.ts
 */
import assert from "node:assert/strict";

import { avoidPhrases, liveCheck, sentences, type LiveCheckInput } from "./live-check";
import type { ComposerContext, SubredditContext } from "./types";

const sub = (over: Partial<SubredditContext> = {}): SubredditContext => ({
  name: "SaaS",
  rules: [
    { n: 1, title: "Submission Guidelines", text: "Posts must be about SaaS." },
    { n: 3, title: "No Vendor Spam on posts or comments", text: "Promotion at most once every 60 days, disclose first." },
  ],
  submitText: "",
  verdict: "requires_disclosure",
  summary: "",
  minKarma: null,
  minAccountAgeDays: null,
  megathread: false,
  guide: { avoid: ['"my tool", links, "DM me"', "generic business advice", "Upvote"], use: ["a concrete SaaS problem"] },
  readAt: "2026-11-25T00:00:00.000Z",
  ...over,
});
const ctx = (platform: ComposerContext["platform"], s: SubredditContext | null = null): ComposerContext => ({
  platform,
  subreddit: s,
  account: { username: null, karma: null, accountCreatedAt: null, postsInSub: null, lastPostInSubAt: null },
  readiness: { level: "unknown", reasons: [] },
});
const run = (over: Partial<LiveCheckInput>) => liveCheck({ platform: "reddit", title: "", body: "", context: ctx("reddit", sub()), products: ["Ferreto"], ...over });

// Sentences are exact substrings; a domain or a decimal does not end one.
{
  const text = "We use ferreto.io/app daily. Revenue went 3.5x!\nWhat did you try?";
  const s = sentences(text).map((x) => x.text);
  assert.deepEqual(s, ["We use ferreto.io/app daily.", "Revenue went 3.5x!", "What did you try?"]);
  for (const q of s) assert.ok(text.includes(q));
  assert.deepEqual(sentences("   \n\n"), []);
}

// The guide's quoted phrases are patterns; prose advice is left to the AI check.
assert.deepEqual(avoidPhrases(['"my tool", links, "DM me"', "generic business advice", "Upvote"]), ["my tool", "DM me", "Upvote"]);

// A plain Reddit post with a title passes.
assert.deepEqual(
  run({ title: "How do you turn a helpful reply into a customer?", body: "I have answered 40 threads in r/SaaS this month. Two people asked what I use. How do you follow up without being pushy?" }),
  [],
);

// Every issue quotes text that is really in the field it names.
{
  const title = "Check out my tool";
  const body = "I made a game changer for founders. Try it at https://ferreto.io today. Ferreto is free. DM me for a code.";
  const issues = run({ title, body });
  assert.ok(issues.length > 0);
  for (const i of issues) {
    assert.equal(i.source, "code");
    assert.ok((i.field === "title" ? title : body).includes(i.quote), `quote not in ${i.field}: ${i.quote}`);
  }
  const rules = issues.map((i) => i.rule);
  assert.ok(rules.includes("Links"));
  assert.ok(rules.includes("No AI slop"));
  assert.ok(rules.includes("r/SaaS guide"));
  // "I made" discloses: the product's name passes in a requires_disclosure sub.
  assert.ok(!rules.includes("Product mention"));
}

// The verdict sets the severity: links and the product's name are blocks where promotion is not allowed.
{
  const body = "Ferreto finds threads like this one. See ferreto.io for more.";
  const disclose = run({ title: "A tool question", body });
  assert.equal(disclose.find((i) => i.rule === "Product mention")?.severity, "warn");
  assert.match(disclose.find((i) => i.rule === "Product mention")!.why, /yours/);
  assert.equal(disclose.find((i) => i.rule === "Links")?.severity, "warn");
  const banned = run({ title: "A tool question", body, context: ctx("reddit", sub({ verdict: "no_product_mention" })) });
  assert.equal(banned.find((i) => i.rule === "Product mention")?.severity, "block");
  assert.equal(banned.find((i) => i.rule === "Links")?.severity, "block");
  assert.equal(banned[0]!.severity, "block", "blocks come first");
  // A name that is part of another word is not the product.
  assert.ok(!run({ title: "A question", body: "Ferretos are not my product." }).some((i) => i.rule === "Product mention"));
}

// Reddit's title: required, ≤ 300 characters, not all caps.
assert.ok(run({ title: "", body: "Some body text here." }).some((i) => i.rule === "Title" && i.severity === "block"));
assert.ok(run({ title: "x".repeat(301), body: "Body." }).some((i) => i.rule === "Length" && i.field === "title"));
assert.ok(run({ title: "HOW DO YOU FIND USERS", body: "Body." }).some((i) => i.rule === "Title" && i.quote === "HOW DO YOU FIND USERS"));

// A question at the end is how a Reddit post asks for answers; on X it reads as bait.
{
  const body = "We doubled replies by answering within an hour. Which channel would you try first?";
  assert.ok(!run({ title: "Replies", body }).some((i) => i.rule === "No AI slop"));
  const x = liveCheck({ platform: "x", title: "", body, context: ctx("x"), products: ["Ferreto"] });
  const bait = x.find((i) => i.rule === "No AI slop");
  assert.equal(bait?.quote, "Which channel would you try first?");
}

// The feeds: the platform's length, hashtags, the first line before "see more"; no title, and the product is fine.
{
  const threads = liveCheck({ platform: "threads", title: "ignored", body: "a".repeat(501), context: ctx("threads"), products: [] });
  assert.ok(threads.some((i) => i.rule === "Length" && i.severity === "block"));
  assert.ok(!threads.some((i) => i.field === "title"));
  const x = liveCheck({ platform: "x", title: "", body: "Ferreto shipped scans for Threads #buildinpublic", context: ctx("x"), products: ["Ferreto"] });
  assert.ok(x.some((i) => i.rule === "Hashtags"));
  assert.ok(!x.some((i) => i.rule === "Product mention"));
  const li = liveCheck({ platform: "linkedin", title: "", body: `${"word ".repeat(40)}\n\nMore.`, context: ctx("linkedin"), products: [] });
  assert.ok(li.some((i) => i.rule === "First line"));
}

// Under 5 ms for a 3,000-character post (median of runs, after a warm-up).
{
  const para = "I answered a thread about churn in r/SaaS and two people asked what I use. Not just a tool, but a habit. Ferreto helped, see ferreto.io. ";
  const body = para.repeat(Math.ceil(3000 / para.length)).slice(0, 3000);
  const input: LiveCheckInput = { platform: "reddit", title: "How do you follow up?", body, context: ctx("reddit", sub()), products: ["Ferreto", "Ferreto Scan"] };
  for (let i = 0; i < 20; i++) liveCheck(input);
  const times: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    liveCheck(input);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[25]!;
  assert.ok(median < 5, `liveCheck took ${median.toFixed(2)} ms`);
  assert.ok(liveCheck(input).length <= 40);
}

// Review 2026-11-25: "Disclosure:" counts as saying it is yours; an apostrophe is not a quote mark in the guide.
{
  const out = run({ title: "Late invoices", body: "Disclosure: Ferreto is mine. Ferreto finds threads." });
  assert.ok(!out.some((i) => /yours/i.test(i.why)), JSON.stringify(out));
  assert.ok(!avoidPhrases(["Don't post 'buy now' links"]).includes("t post"));
}
console.log("live-check.check: ok");
