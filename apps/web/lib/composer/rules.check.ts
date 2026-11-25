/**
 * The Composer's rules reader (plan 2026-11-25, Part L):
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/composer/rules.check.ts
 */
import assert from "node:assert/strict";

import { parseRules, subName } from "./rules";

// r/SaaS as ScrapeCreators returned it on 2026-11-25 (shortened).
const saas = `1 Submission Guidelines Follow the Reddit site-wide rules and please treat others with respect, stay on-topic, and avoid non-productive self-promotion.

2 Posting SaaS Relevant Content Only Please keep the discussions oriented around the SaaS ecosystem. No Generic Business: General entrepreneurship without a SaaS angle will be removed.

3 No Vendor Spam on posts or comments Promotion is allowed occasionally, but accounts focused solely on it will be removed. Limit: Max 1 mention or 3 links every 60 days.`;
const rules = parseRules(saas);
assert.deepEqual(rules.map((r) => r.n), [1, 2, 3]);
assert.deepEqual(rules.map((r) => r.title), ["Submission Guidelines", "Posting SaaS Relevant Content Only", "No Vendor Spam on posts or comments"]);
assert.ok(rules[2]!.text.startsWith("Promotion is allowed occasionally"), rules[2]!.text);
assert.ok(rules[1]!.text.includes("No Generic Business"), "the body keeps its sub-points");

// "1." and "2)" numbering, and a paragraph that continues the rule before it.
const dotted = parseRules("1. Be kind Do not insult people.\n\nThis includes DMs.\n\n2) No links You may not post links.");
assert.deepEqual(dotted.map((r) => [r.n, r.title]), [[1, "Be kind"], [2, "No links"]]);
assert.ok(dotted[0]!.text.includes("This includes DMs."));
assert.deepEqual(parseRules(""), []);
assert.equal(parseRules("Just be nice to each other.")[0]!.n, 1, "unnumbered rules are one rule");

assert.equal(subName("r/SaaS"), "SaaS");
assert.equal(subName("/r/startups "), "startups");
assert.equal(subName("bad name"), null);
assert.equal(subName("a"), null);
// Real subs (2026-11-25) put the title on its own line.
const lined = parseRules("5 Rules for Links in Comments/Discussion\nSometimes you think the best source is a link.\n\n9 No Unscheduled AMAs\nWe do not allow unscheduled AMAs.");
assert.deepEqual(lined.map((r) => [r.n, r.title]), [[5, "Rules for Links in Comments/Discussion"], [9, "No Unscheduled AMAs"]]);
assert.equal(lined[1]!.text, "We do not allow unscheduled AMAs.");
// Review 2026-11-25: a number out of order inside a rule's body stays in that rule.
const inner = parseRules("1 Be kind\nNo insults.\n\n2 Promotion\nAllowed:\n2 links per month max\n\n3 No AMAs\nAsk first.");
assert.deepEqual(inner.map((r) => [r.n, r.title]), [[1, "Be kind"], [2, "Promotion"], [3, "No AMAs"]]);
assert.ok(inner[1]!.text.includes("2 links per month max"));
console.log("composer rules: ok");
