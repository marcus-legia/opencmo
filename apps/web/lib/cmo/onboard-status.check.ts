/**
 * Setup's steps and its end (CMO review 3, 3.2).
 *
 *     cd apps/web && npx tsx lib/cmo/onboard-status.check.ts
 */
import assert from "node:assert/strict";

import { setupFinished, setupSteps, type OnboardingStatus } from "./onboard-status";

const base: OnboardingStatus = {
  run: { id: "r", status: "running", error: null, steps: [], createdAt: "2026-11-10T08:00:00Z" },
  plan: null,
  draft: null,
  answers: { xHandle: null, platforms: null, heardFrom: null },
  suggestedHandle: null,
};

// The steps in order, each in its real state.
const steps = setupSteps({ ...base, run: { ...base.run!, steps: [{ id: "site", status: "done" }, { id: "product", status: "running" }] } });
assert.deepEqual(
  steps.map((step) => `${step.id}:${step.state}`),
  ["site:done", "product:running", "strategy:waiting", "competitors:waiting", "content_strategy:waiting", "plan:waiting", "draft:waiting"],
);
assert.equal(steps[0]!.label, "Reading your website");
assert.equal(setupSteps({ ...base, plan: "queued", draft: "failed" }).slice(5).map((s) => s.state).join(), "running,failed");

// The end: never while the run works or after it failed; at once when the drafts end; after a wait with no plan.
assert.equal(setupFinished(base, 0), false);
assert.equal(setupFinished({ ...base, run: { ...base.run!, status: "failed" } }, 99_000), false);
const done = { ...base, run: { ...base.run!, status: "done" as const } };
assert.equal(setupFinished({ ...done, plan: "done", draft: "running" }, 5_000), false);
assert.equal(setupFinished({ ...done, plan: "done", draft: "done" }, 0), true);
assert.equal(setupFinished({ ...done, plan: "failed" }, 0), true);
assert.equal(setupFinished({ ...done, plan: null }, 5_000), false);
assert.equal(setupFinished({ ...done, plan: null }, 16_000), true, "no plan followed: the documents are still worth reading");
assert.equal(setupFinished({ ...done, run: null }, 99_000), false);

console.log("onboard-status.check: every check passed");
