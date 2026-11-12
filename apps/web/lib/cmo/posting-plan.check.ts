/**
 * The posting plan's pure helpers:
 *
 *     cd apps/web && npx tsx lib/cmo/posting-plan.check.ts
 */
import assert from "node:assert/strict";

import { PostingPlanSchema, TEXT_PLATFORMS, VIDEO_PLATFORMS, dayTargets, defaultPostingPlan, type PostingPlan } from "./posting-plan";

const failures: string[] = [];
function check(label: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const zeroVideo = { tiktok: 0, instagram: 0, youtube: 0 };

check("post i targets every platform whose count is above i", () => {
  const plan: PostingPlan = { text: { x: 2, threads: 1, linkedin: 1, facebook: 0 }, video: zeroVideo };
  assert.deepEqual(dayTargets(plan), [["x", "threads", "linkedin"], ["x"]]);
});

check("all zero gives no posts", () => {
  const plan: PostingPlan = { text: { x: 0, threads: 0, linkedin: 0, facebook: 0 }, video: zeroVideo };
  assert.deepEqual(dayTargets(plan), []);
});

check("nothing connected defaults to X, one a day", () => {
  const plan = defaultPostingPlan([]);
  assert.equal(plan.text.x, 1);
  assert.equal(plan.text.threads, 0);
  assert.equal(plan.text.linkedin, 0);
});

check("connected platforms default to one a day, video stays off", () => {
  const plan = defaultPostingPlan(["linkedin", "tiktok"]);
  assert.equal(plan.text.linkedin, 1);
  assert.equal(plan.text.x, 0);
  for (const p of VIDEO_PLATFORMS) assert.equal(plan.video[p], 0);
  assert.deepEqual(Object.keys(plan.text), [...TEXT_PLATFORMS]);
});

check("the schema rejects out-of-range counts", () => {
  const base = defaultPostingPlan([]);
  assert.equal(PostingPlanSchema.safeParse(base).success, true);
  assert.equal(PostingPlanSchema.safeParse({ ...base, text: { ...base.text, x: 4 } }).success, false);
  assert.equal(PostingPlanSchema.safeParse({ ...base, video: { ...base.video, tiktok: 8 } }).success, false);
  assert.equal(PostingPlanSchema.safeParse({ ...base, text: { ...base.text, x: 1.5 } }).success, false);
});

if (failures.length) {
  console.error(`posting-plan.check: ${failures.length} failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("posting-plan.check: ok");
