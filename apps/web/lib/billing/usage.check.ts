/**
 * The fair-use bar's row parser, offline.
 *
 *     tsx lib/billing/usage.check.ts
 */
import assert from "node:assert/strict";

import { FREE_USAGE, OPEN_USAGE_STATE, parsePlanUsage, parseUsageState } from "./usage";

// 1. A paid row from Postgres (snake_case, numbers as strings from numeric columns).
{
  const usage = parsePlanUsage({
    plan: "pro",
    interval: "month",
    used: "600",
    allowance: 1000,
    percent: 60,
    resets_at: "2026-12-18T00:00:00+00:00",
    paused: false,
  });
  assert.deepEqual(usage, {
    plan: "pro",
    interval: "month",
    used: 600,
    allowance: 1000,
    percent: 60,
    resetsAt: "2026-12-18T00:00:00+00:00",
    paused: false,
  });
}

// 2. `rpc()` on a set-returning function answers an array; the first row is the founder's.
assert.equal(parsePlanUsage([{ plan: "pro", interval: "year", used: 10, allowance: 1000 }]).percent, 1);

// 3. The percentage rounds down and stops at 100; the pause follows used >= allowance, not the row's own flag.
{
  assert.equal(parsePlanUsage({ plan: "pro", used: 999, allowance: 1000 }).percent, 99);
  assert.equal(parsePlanUsage({ plan: "pro", used: 999, allowance: 1000, paused: true }).paused, false);
  const over = parsePlanUsage({ plan: "pro", used: 1300, allowance: 1000, paused: false });
  assert.equal(over.percent, 100);
  assert.equal(over.paused, true);
}

// 4. A paid row with no allowance never pauses and never divides by zero.
{
  const none = parsePlanUsage({ plan: "pro", used: 5, allowance: 0 });
  assert.equal(none.percent, 0);
  assert.equal(none.paused, false);
}

// 5. Free accounts, empty answers and junk read as the free bar.
for (const row of [null, undefined, [], "x", { plan: "free", used: 50, allowance: 0 }, { plan: "team" }]) {
  assert.deepEqual(parsePlanUsage(row), FREE_USAGE);
}

// 6. Bad numbers and dates are dropped, not passed to the screen.
{
  const bad = parsePlanUsage({ plan: "pro", interval: "week", used: -4, allowance: "abc", resets_at: "soon" });
  assert.equal(bad.used, 0);
  assert.equal(bad.allowance, 0);
  assert.equal(bad.interval, null);
  assert.equal(bad.resetsAt, null);
}

// 5. `my_usage_state()`: a paid account at 100%.
{
  const state = parseUsageState({
    plan: "pro",
    interval: "month",
    used: 100,
    allowance: 100,
    percent: 100,
    resets_at: "2026-12-18T00:00:00+00:00",
    blocked: true,
    reason: "allowance_used",
    stopped: ["sales_scan", "research"],
    still_works: ["read", "edit", "copy_drafts", "post_drafts", "reply_drafts", "unknown"],
    free_scan: null,
  });
  assert.equal(state.blocked, true);
  assert.equal(state.paused, true);
  assert.equal(state.reason, "allowance_used");
  assert.deepEqual(state.stopped, ["sales_scan", "research"]);
  assert.deepEqual(state.stillWorks, ["read", "edit", "copy_drafts", "post_drafts", "reply_drafts"]);
  assert.equal(state.resetsAt, "2026-12-18T00:00:00+00:00");
}

// 6. A free account after its free scan; then nothing readable.
{
  const state = parseUsageState({
    plan: "free",
    used: 0,
    allowance: 0,
    percent: 0,
    resets_at: null,
    blocked: true,
    reason: "free_scan_used",
    stopped: ["sales_scan", "reply_drafts", "post_drafts"],
    still_works: ["read", "edit", "copy_drafts"],
    free_scan: "used",
  });
  assert.equal(state.plan, "free");
  assert.equal(state.reason, "free_scan_used");
  assert.equal(state.freeScan, "used");
  assert.deepEqual(state.stopped, ["sales_scan", "reply_drafts", "post_drafts"]);
  // A reason that does not fit the plan is not a block.
  assert.equal(parseUsageState({ plan: "free", blocked: true, reason: "allowance_used" }).blocked, false);
  assert.deepEqual(parseUsageState(null), OPEN_USAGE_STATE);
  assert.deepEqual(parseUsageState([1]), OPEN_USAGE_STATE);
}

console.log("billing/usage.check: ok");
