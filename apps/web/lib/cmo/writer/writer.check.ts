/**
 * Writer's pure parts: the contract (kinds, the video brief shared with Studio); W0's post rules (no links,
 * no hashtags) and No AI Slop as guidance read by the writer, the checker, sales and CMO chat.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/writer/writer.check.ts
 */
import assert from "node:assert/strict";

import { VideoBriefSchema as StudioBriefSchema } from "@/lib/departments/studio/types";
import { briefRequest } from "@/lib/departments/studio/video";

import { checkPost } from "../jobs/check-post";
import { REVIEW_SYSTEM } from "../jobs/draft-post";
import { stockPatterns } from "../jobs/eval/style";
import { CMO_SKILLS } from "../skills/index.gen";
import { skillIndex } from "../skills";

import { PROFILE_KIND, VideoBriefSchema, WRITER_KINDS } from "./types";

assert.equal(StudioBriefSchema, VideoBriefSchema, "Studio takes Writer's video brief, not a copy");
assert.deepEqual(Object.keys(PROFILE_KIND).sort(), [...WRITER_KINDS].sort(), "every kind says which profile it drafts for");

const brief = VideoBriefSchema.parse({ objective: "Show founders a demo video made from one slash command", hooks: ["What if your demo made itself?"] });
assert.deepEqual([brief.cta, brief.angle, brief.seconds, brief.aspect], ["", "", 30, "9:16"], "an older brief without a call to action still parses");
assert.doesNotMatch(briefRequest(brief).prompt, /call to action/, "no call to action line when the brief has none");
const withCta = VideoBriefSchema.parse({ ...brief, cta: "Try /video on your own demo" });
assert.match(briefRequest(withCta).prompt, /End with this call to action: Try \/video on your own demo/, "the Director reads the brief's call to action");

// W0: no links and no hashtags in a post; tech names, "#1" and "C#" are neither.
const rules = { avoid: [], known: new Set<string>() };
for (const text of ["Read more at https://example.com", "Details on www.example.com", "Try opencmo.io/pricing today", "Our docs live at Paylane.app"]) {
  assert.ok(checkPost(text, rules).some((issue) => issue.includes("link")), `a link is refused: ${text}`);
}
for (const text of ["Shipping this week #buildinpublic", "#saas tip of the day", "We ship.\n#indiehackers"]) {
  assert.ok(checkPost(text, rules).some((issue) => issue.includes("hashtag")), `a hashtag is refused: ${text}`);
}
for (const text of ["We moved the app to Next.js and Node.js.", "Our #1 rule: answer within a day.", "I wrote it in C# first.", "Ship it. Then measure."]) {
  assert.deepEqual(checkPost(text, rules), [], `not a link or a hashtag: ${text}`);
}

// No AI Slop is guidance in a skill, read by the writer, the checker, sales and CMO chat; never a code check.
assert.deepEqual([...CMO_SKILLS["no-ai-slop"].agents].sort(), ["checker", "cmo", "sales", "x_writer"]);
assert.match(CMO_SKILLS["no-ai-slop"].license, /MIT — Copyright \(c\) 2026 Peter Yang/);
for (const agent of ["x_writer", "checker", "sales", "cmo"] as const) assert.ok(skillIndex(agent).includes("- no-ai-slop:"), `${agent} lists no-ai-slop`);
assert.ok(REVIEW_SYSTEM.includes('<skill name="no-ai-slop">') && /advice/.test(REVIEW_SYSTEM), "the checker reads the guidance as advice");
const body = CMO_SKILLS["no-ai-slop"].body;
const words = body.split(/\s+/).filter(Boolean).length;
assert.ok(words >= 1400 && words <= 2000, `about 1,700 words (got ${words})`);
for (const left of ["What changed", "Two jobs", "What to ask for", "ask them to paste"]) assert.ok(!body.includes(left), `its chat parts stay out: ${left}`);
const xWriting = CMO_SKILLS["x-writing"].body;
for (const taught of ["isn't what you think", "is wrong. Here's why:", "the last post sums up", "1-2 hashtags", "link in reply"]) {
  assert.ok(!xWriting.includes(taught), `x-writing no longer teaches: ${taught}`);
}

// The eval's stock-pattern measure: catches the old fake drafts, passes the new ones and plain posts.
assert.deepEqual(stockPatterns("Most founders skip this: polite reminders get invoices paid."), ["faux_insight", "colon_reveal"]);
assert.deepEqual(stockPatterns("A small thing we changed in Paylane: reminders on day 3."), ["colon_reveal"]);
assert.deepEqual(stockPatterns("The question isn't the model. It's the eval."), ["binary_contrast"]);
assert.deepEqual(stockPatterns("Reminders work.\n\nUltimately, consistency wins."), ["recap_ending"]);
assert.deepEqual(stockPatterns("We ship daily — and it shows."), ["em_dash"]);
for (const clean of [
  "Why polite reminders on day 3, 7 and 14 get invoices paid.\n\nWe learned it building Paylane this week.",
  "We tried the usual advice first and it did not work for us. Why polite reminders on day 3, 7 and 14 get invoices paid.",
  "We changed one small thing in Paylane this week. Why polite reminders on day 3, 7 and 14 get invoices paid.",
  "How to get paid without chasing:\n1. Send the invoice the day the work ends.",
  "Overall revenue grew after we added reminders.",
]) assert.deepEqual(stockPatterns(clean), [], `clean: ${clean}`);

console.log("writer.check: ok");
