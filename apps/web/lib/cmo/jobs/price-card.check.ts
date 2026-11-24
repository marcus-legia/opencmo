/**
 *     cd apps/web && npx tsx lib/cmo/jobs/price-card.check.ts
 */
import assert from "node:assert/strict";

import { costLine, salesScanCard } from "./price-card";
import { JOB_PRICES } from "./progress";

assert.equal(costLine(salesScanCard().credits), "Uses 5 credits of your monthly allowance.");
assert.equal(costLine(1), "Uses 1 credit of your monthly allowance.");
assert.equal(costLine(JOB_PRICES.sales_reply_drafts ?? 0), "Included: uses none of your allowance.");
assert.equal(costLine(5, true), "Free: this scan uses none of your allowance.");
console.log("price-card: ok");
