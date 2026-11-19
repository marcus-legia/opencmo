/**
 * Setup's steps and its end (CMO review 3, 3.2).
 *
 *     cd apps/web && npx tsx lib/cmo/onboard-status.check.ts
 */
import assert from "node:assert/strict";

import { setupDestination, setupFinished, setupSteps, type OnboardingStatus } from "./onboard-status";

const base: OnboardingStatus = {
  run: { id: "r", status: "running", error: null, steps: [], createdAt: "2026-11-10T08:00:00Z" },
  scan: null,
  scanCards: null,
  plan: null,
  draft: null,
  answers: { xHandle: null, platforms: null, heardFrom: null },
  suggestedHandle: null,
};

// The steps in order, each in its real state.
const steps = setupSteps({ ...base, run: { ...base.run!, steps: [{ id: "site", status: "done" }, { id: "product", status: "running" }] } });
assert.deepEqual(
  steps.map((step) => `${step.id}:${step.state}`),
  ["site:done", "product:running", "strategy:waiting", "competitors:waiting", "post_plan:waiting", "brand:waiting", "plan:waiting", "draft:waiting"],
);
assert.equal(steps[0]!.label, "Reading your website");
assert.equal(setupSteps({ ...base, plan: "queued", draft: "failed" }).slice(6).map((s) => s.state).join(), "running,failed");

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
assert.equal(setupFinished({ ...done, plan: "queued" }, 60_000), false);
assert.equal(setupFinished({ ...done, plan: "queued" }, 121_000), true, "a plan waiting in the founder's Claude does not keep Setup forever");

// The free scan (free-scan plan): its step sits between the documents and the plan, and only when the run queued one.
assert.equal(setupSteps(base).some((s) => s.id === "scan"), false);
assert.deepEqual(
  setupSteps({ ...base, scan: "running" }).map((s) => s.id),
  ["site", "product", "strategy", "competitors", "post_plan", "brand", "scan", "plan", "draft"],
);
assert.equal(setupSteps({ ...base, scan: "queued" }).find((s) => s.id === "scan")!.label, "Finding people who describe the problem");

// With a scan, Setup ends with it (the plan may still run); never before the documents are saved.
assert.equal(setupFinished({ ...base, scan: "done" }, 0), false);
assert.equal(setupFinished({ ...done, scan: "running", plan: "done", draft: "done" }, 5_000), false, "the drafts do not end Setup while the scan runs");
assert.equal(setupFinished({ ...done, scan: "running" }, 121_000), true, "a slow scan does not keep Setup forever");
assert.equal(setupFinished({ ...done, scan: "done", plan: "queued" }, 0), true);
assert.equal(setupFinished({ ...done, scan: "failed" }, 0), true);

// Where it goes: Sales while the scan runs or when it found people; the Dashboard otherwise.
assert.equal(setupDestination({ ...done, scan: "running" }), "/app/sales");
assert.equal(setupDestination({ ...done, scan: "queued" }), "/app/sales");
assert.equal(setupDestination({ ...done, scan: "done", scanCards: 4 }), "/app/sales");
assert.equal(setupDestination({ ...done, scan: "done", scanCards: 0 }), "/app");
assert.equal(setupDestination({ ...done, scan: "failed" }), "/app");
assert.equal(setupDestination(done), "/app");

console.log("onboard-status.check: every check passed");
