/**
 * The owner's funnel page rows (lib/ops/funnel.ts). No database.
 *
 *   cd apps/web && npx tsx lib/ops/funnel.check.ts
 */
import assert from "node:assert/strict";

import { duration, funnelRows, pct, type FunnelReport } from "./funnel";

const report: FunnelReport = {
  since: "2026-10-17T00:00:00Z",
  steps: [
    { step: "signed_up", users: 10 },
    { step: "onboarded", users: 8 },
    { step: "approved", users: 4 },
    { step: "scheduled", users: 3 },
    { step: "posted", users: 2 },
    { step: "paid", users: 1 },
  ],
  median_seconds: { onboarded: 95, approved: 7200, posted: null },
  active_7d: { eligible: 6, active: 3, paid_eligible: 1, paid_active: 1 },
  by_week: [],
};

const rows = funnelRows(report);
assert.deepEqual(rows.map((row) => row.previous), [null, 10, 8, 4, 3, null], "each step against the one before; paid against none");
assert.equal(rows[1]!.median, "2 min");
assert.equal(rows[2]!.median, "2.0 h");
assert.equal(rows[4]!.median, null, "no one posted yet: no median");
assert.equal(rows[0]!.label, "Signed up");

assert.equal(pct(4, 10), "40%");
assert.equal(pct(1, 0), "—", "nothing to divide by");
assert.equal(duration(30), "30 s");
assert.equal(duration(2 * 86_400), "2.0 days");
assert.equal(duration(null), null);

console.log("funnel.check: ok");
