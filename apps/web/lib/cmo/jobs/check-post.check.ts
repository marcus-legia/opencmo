/**
 * Links in posts and captions (review follow-up Q8): `hasLink` and SQL `caption_check` agree on the shared cases in
 * `packages/contracts/link-cases.json`, and pgTAP 244 tests the same strings.
 *
 *     tsx lib/cmo/jobs/check-post.check.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { asksNoPitch, briefRules, checkPost, hasLink } from "./check-post";

const cases = JSON.parse(readFileSync(new URL("../../../../../packages/contracts/link-cases.json", import.meta.url), "utf8")) as { refused: string[]; allowed: string[] };
const pgtap = readFileSync(new URL("../../../../../supabase/tests/244_review_followups.test.sql", import.meta.url), "utf8");

for (const text of cases.refused) assert.ok(hasLink(text), `a link: ${text}`);
for (const text of cases.allowed) assert.ok(!hasLink(text), `not a link: ${text}`);
for (const text of [...cases.refused, ...cases.allowed]) assert.ok(pgtap.includes(text.replace(/'/g, "''")), `pgTAP 244 tests "${text}" too`);

// The founder's own brief carries their facts; a planner's brief does not (2026-11-12: "$100/month" was dropped as
// invented and the writer pitched the product instead).
const docs = { avoid: [], known: new Set(["60", "1060"]), names: ["OpenCMO"] };
const brief = "Founder-supplied facts, use them: a Vietnam startup builds a SaaS on $100/month. No product pitch, no invented stats.";
const post = "I am building a SaaS from Vietnam on $100/month. Every dollar has a job.";
assert.ok(checkPost(post, briefRules(docs, brief, false)).some((issue) => /says 100,/.test(issue)), "a planner's number must be in the documents");
assert.deepEqual(checkPost(post, briefRules(docs, brief, true)), [], "the founder's own number is known");
assert.ok(checkPost("OpenCMO covers it for $60/month.", briefRules(docs, brief, true)).some((issue) => /no product pitch/.test(issue)), "no pitch: naming the product is refused");
assert.deepEqual(checkPost("OpenCMO covers it for $60/month.", briefRules(docs, "Post about our pricing", true)), [], "without the ask, naming it is fine");
for (const ask of ["No product pitch.", "no pitch", "Don't mention OpenCMO", "never pitch the product", "No promo"]) assert.ok(asksNoPitch(ask), ask);
for (const fine of ["Pitch deck lessons", "How we price it", "No invented stats"]) assert.ok(!asksNoPitch(fine), fine);

// X weighs an arrow as 2: 150 of them are 300 on X, though 150 characters by code point.
const arrows = `Steps ${"→".repeat(150)}`;
assert.ok(checkPost(arrows, briefRules(docs, brief, true), { limit: 280, platform: "X" }).some((issue) => /306 characters; X allows 280/.test(issue)),
  "X's own count decides an X post's length");
assert.ok(!checkPost(arrows, briefRules(docs, brief, true), { limit: 500, platform: "Threads" }).some((issue) => /characters/.test(issue)),
  "Threads counts characters");

console.log("check-post.check ok");
