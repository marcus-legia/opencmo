/**
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/composer/account.check.ts
 */
import assert from "node:assert/strict";

import { readiness, redditUser } from "./account";
import type { AccountContext, SubredditContext } from "./types";

assert.equal(redditUser("u/My_Handle"), "My_Handle");
assert.equal(redditUser("/u/abc"), "abc");
assert.equal(redditUser("bad name"), null, "spaces are refused");
assert.equal(redditUser("x) OR author:spez"), null, "nothing that could change the search");
assert.equal(redditUser(null), null);

const now = new Date("2026-11-25T00:00:00Z");
const sub: SubredditContext = {
  name: "SaaS", rules: [], submitText: "", verdict: "requires_disclosure", summary: "", minKarma: 100, minAccountAgeDays: 30,
  megathread: false, guide: { avoid: [], use: [] }, readAt: now.toISOString(),
};
const ok: AccountContext = { username: "me", karma: 500, accountCreatedAt: "2025-01-01T00:00:00Z", postsInSub: 2, lastPostInSubAt: null };

assert.equal(readiness(sub, ok, now).level, "ready");
assert.equal(readiness(sub, { ...ok, username: null }, now).level, "unknown", "no username");
const unknown = readiness(sub, { ...ok, karma: null }, now);
assert.equal(unknown.level, "unknown", "never ready with karma unknown (Review Focus 4)");
const low = readiness(sub, { ...ok, karma: 40 }, now);
assert.equal(low.level, "not_ready");
assert.ok(low.reasons[0]!.includes("100 karma; you have 40"));
assert.equal(readiness(sub, { ...ok, accountCreatedAt: "2026-11-10T00:00:00Z" }, now).level, "not_ready", "younger than the sub asks");
const fresh = readiness({ ...sub, minKarma: null, minAccountAgeDays: null }, { ...ok, karma: 20, postsInSub: 0 }, now);
assert.equal(fresh.level, "caution");
assert.ok(fresh.reasons.some((r) => r.includes("Under 50 karma")) && fresh.reasons.some((r) => r.includes("not posted in r/SaaS")));
assert.equal(readiness({ ...sub, verdict: "skip" }, ok, now).level, "not_ready");
// Review 2026-11-25: a month counts from its last day. Made 2026-11-20, stored as November: on 2026-11-25 it is not
// 24 days old for a sub that asks 14.
assert.equal(readiness({ ...sub, minKarma: null, minAccountAgeDays: 14 }, { ...ok, accountCreatedAt: "2026-11-01T00:00:00Z" }, now).level, "not_ready");
// An unknown post count gives no "not posted yet" line.
assert.ok(!readiness({ ...sub, minKarma: null }, { ...ok, postsInSub: null }, now).reasons.some((r) => r.includes("not posted")));
console.log("composer account: ok");
