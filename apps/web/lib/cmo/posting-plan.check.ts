/**
 * The posting plan's pure helpers:
 *
 *     cd apps/web && npx tsx lib/cmo/posting-plan.check.ts
 */
import assert from "node:assert/strict";

import { PostingPlanSchema, TEXT_PLATFORMS, VIDEO_PLATFORMS, chosenChannels, connectedOnly, dayTargets, defaultPostingPlan, planOrDefault, type PostingPlan } from "./posting-plan";

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

check("chosen channels fill the default with nothing connected", () => {
  assert.deepEqual(defaultPostingPlan([], ["x", "threads"]).text, { x: 1, threads: 1, linkedin: 0, facebook: 0 });
  assert.deepEqual(defaultPostingPlan([], []).text, { x: 1, threads: 0, linkedin: 0, facebook: 0 });
});

check("connected and chosen join; non-text channels are dropped", () => {
  assert.deepEqual(defaultPostingPlan(["linkedin"], ["threads", "tiktok"]).text, { x: 0, threads: 1, linkedin: 1, facebook: 0 });
});

check("a saved plan wins over the chosen channels", () => {
  assert.equal(planOrDefault({ text: { x: 2 }, video: {} }, [], ["threads"]).text.threads, 0);
  assert.equal(planOrDefault({ text: { x: 2 }, video: {} }, [], ["threads"]).text.x, 2);
  assert.equal(planOrDefault(null, [], ["threads"]).text.threads, 1);
});

check("chosenChannels keeps strings only", () => {
  assert.deepEqual(chosenChannels({ channels: ["x", 3, null, "threads"] }), ["x", "threads"]);
  assert.deepEqual(chosenChannels({ channels: "x" }), []);
  assert.deepEqual(chosenChannels(undefined), []);
});

check("the schema rejects out-of-range counts", () => {
  const base = defaultPostingPlan([]);
  assert.equal(PostingPlanSchema.safeParse(base).success, true);
  assert.equal(PostingPlanSchema.safeParse({ ...base, text: { ...base.text, x: 4 } }).success, false);
  assert.equal(PostingPlanSchema.safeParse({ ...base, video: { ...base.video, tiktok: 8 } }).success, false);
  assert.equal(PostingPlanSchema.safeParse({ ...base, text: { ...base.text, x: 1.5 } }).success, false);
});

check("connectedOnly: a platform with no account writes nothing, and the saved counts are kept", () => {
  const plan: PostingPlan = { text: { x: 2, threads: 1, linkedin: 3, facebook: 0 }, video: zeroVideo };
  const running = connectedOnly(plan, ["x"]);
  assert.deepEqual(running.text, { x: 2, threads: 0, linkedin: 0, facebook: 0 });
  // The founder's own plan is untouched: connecting Threads again brings its post back without retyping the number.
  assert.deepEqual(plan.text, { x: 2, threads: 1, linkedin: 3, facebook: 0 });
  // Video is not part of this rule.
  assert.deepEqual(running.video, plan.video);
  assert.deepEqual(connectedOnly(plan, []).text, { x: 0, threads: 0, linkedin: 0, facebook: 0 });
  assert.deepEqual(connectedOnly(plan, ["x", "threads", "linkedin"]).text, plan.text);
  // An account connected on a platform the plan has off stays off: connecting is not turning it on.
  assert.equal(connectedOnly({ ...plan, text: { ...plan.text, x: 0 } }, ["x"]).text.x, 0);
});

check("connectedOnly: the day's targets drop the platforms that cannot receive them", () => {
  const plan: PostingPlan = { text: { x: 1, threads: 1, linkedin: 0, facebook: 0 }, video: zeroVideo };
  assert.deepEqual(dayTargets(plan), [["x", "threads"]]);
  assert.deepEqual(dayTargets(connectedOnly(plan, ["x"])), [["x"]]);
  assert.deepEqual(dayTargets(connectedOnly(plan, [])), []);
});

if (failures.length) {
  console.error(`posting-plan.check: ${failures.length} failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("posting-plan.check: ok");
