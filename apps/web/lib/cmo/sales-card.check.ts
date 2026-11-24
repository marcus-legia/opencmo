/**
 * The Sales card's rule badge and old-thread line (owner test 2026-11-23):
 *
 *     cd apps/web && npx tsx lib/cmo/sales-card.check.ts
 */
import assert from "node:assert/strict";

import { oldDays, ruleHeadline } from "./sales-card";

const help = { rule: { kind: "help_only" as const, text: "" }, platform: "reddit" as const, person: undefined, postedAt: null };
assert.equal(ruleHeadline(help), "Help only · don't promote · DM them later");
assert.equal(ruleHeadline({ ...help, platform: "hn" }), "Help only · don't promote", "Hacker News has no DMs");
assert.equal(
  ruleHeadline({ ...help, person: { reach: { dmAllowed: false } } as never }),
  "Help only · don't promote",
  "a community that forbids DMs never says DM them later",
);
assert.equal(ruleHeadline({ ...help, person: { reach: { dmAllowed: true, buyer: false } } as never }), "Help only · don't promote", "a seller is never DMed");
assert.equal(ruleHeadline({ ...help, postedAt: "2026-10-01T00:00:00Z" }, Date.parse("2026-11-24T00:00:00Z")), "Help only · don't promote", "nor an old thread");
assert.equal(ruleHeadline({ ...help, rule: { kind: "requires_disclosure", text: "" } }), "You may name it · say it's yours");
assert.equal(ruleHeadline({ ...help, rule: { kind: "mention_allowed", text: "" } }), "You may name your product once");
assert.equal(ruleHeadline({ ...help, rule: { kind: "skipped", text: "" } }), "Don't reply here");

const now = Date.parse("2026-11-24T12:00:00Z");
assert.equal(oldDays("2026-11-11T12:00:00Z", now), null, "13 days is not old");
assert.equal(oldDays("2026-10-28T12:00:00Z", now), 27);
assert.equal(oldDays(null, now), null);
assert.equal(oldDays("not a date", now), null);
console.log("sales-card: ok");
