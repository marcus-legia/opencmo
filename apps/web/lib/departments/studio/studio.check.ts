/**
 * The Studio adapter's pure parts: who may call what, the video brief → `create_video` input, and the
 * card fields `studio_steps.card` stores for `approval_snapshot`.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/departments/studio/studio.check.ts
 */
import assert from "node:assert/strict";

import { ScriptSnapshotSchema, PriceSnapshotSchema } from "@/lib/screens/approval-card";

import { renderRequestId } from "./render";
import { stepCard } from "./steps";
import { mayCall, VideoBriefSchema } from "./types";
import { briefRequest } from "./video";

assert.ok(mayCall("brain", "buildVideo") && !mayCall("mcp", "buildVideo") && !mayCall("assistant", "buildVideo"));
assert.ok(mayCall("ui", "markFinished") && !mayCall("brain", "markFinished"), "only the founder marks an edit finished");
assert.ok(mayCall("ui", "cutShorts") && mayCall("brain", "cutShorts") && !mayCall("mcp", "cutShorts"));
assert.ok(mayCall("mcp", "plan") && mayCall("mcp", "decide") && !mayCall("ui", "plan"));

const brief = VideoBriefSchema.parse({ objective: "Show founders a demo video made from one slash command", hooks: ["What if your demo made itself?"], keyPoints: ["/video makes a 30 s video"] });
assert.deepEqual([brief.seconds, brief.aspect, brief.angle, brief.voice], [30, "9:16", "", undefined], "defaults");
assert.throws(() => VideoBriefSchema.parse({ objective: "x" }), "an objective needs words");
assert.throws(() => VideoBriefSchema.parse({ objective: "A video", seconds: 120 }), "at most 90 s");

const request = briefRequest(brief, { voice: "Calm and direct.", avoid: ["guaranteed growth"] });
assert.deepEqual([request.seconds, request.aspect, "voice" in request], [30, "9:16", false]);
assert.match(request.prompt, /^Goal: Show founders/);
assert.match(request.prompt, /Open with one of these hooks \(the first is preferred\): "What if your demo made itself\?"/);
assert.match(request.prompt, /Facts to use \(use no others\): \/video makes a 30 s video/);
assert.match(request.prompt, /Brand voice: Calm and direct\./);
assert.match(request.prompt, /Never say or imply: guaranteed growth/);
assert.doesNotMatch(briefRequest(brief).prompt, /Brand voice|Never say/, "no strategy, no voice lines");
assert.equal(briefRequest({ ...brief, voice: "Test A" }).voice, "Test A");
assert.ok(briefRequest({ ...brief, keyPoints: Array.from({ length: 6 }, () => "x".repeat(200)), angle: "y".repeat(300) }, { voice: "z".repeat(900) }).prompt.length <= 2000);

// Card 1: the Director's beats, field for field with the script snapshot.
const plan = {
  title: "One command",
  script: "What if your demo made itself? Type slash video.",
  style: "clean",
  music: "calm",
  shots: [
    { words: "What if your demo made itself?", keyframe: "A desk at dawn", motion: "slow push in", continues: true, seconds: 5 },
    { words: "Type slash video.", keyframe: "A laptop screen", motion: "", continues: false, seconds: 5 },
  ],
};
const script = stepCard({ kind: "priced", credits: 12, lines: ["Create a 10s 9:16 video, step 1 of 2"], prepared: { clipId: "c", tool: "create_video", input: { longTake: { plan, aspect: "9:16", seconds: 10 } } } });
assert.equal(script.kind, "script");
assert.deepEqual(script.card.beats, [
  { words: "What if your demo made itself?", picture: "A desk at dawn", motion: "slow push in" },
  { words: "Type slash video.", picture: "A laptop screen", motion: null },
]);
ScriptSnapshotSchema.parse({ kind: "script", step_id: "s", clip_id: "c", tool: "create_video", price_credits: 12, ...script.card });

// Card 2: the contact sheet keeps storage paths (never the signed URL) and counts the shots it buys.
const sheet = { tiles: [{ index: 0, words: "What if", url: "https://signed.example/a", path: "u/job/a.png", garbled: false, credits: 2 }] };
const price = stepCard({
  kind: "priced",
  credits: 80,
  lines: ["Animate a 10s 9:16 video: 2 shots", "Shots on Model · 80 credits"],
  sheet,
  prepared: { clipId: "c", tool: "animate_video", input: { op: { op: "create_video", seconds: 10, shots: [{}, {}] }, extra: [{}, {}, {}] } },
});
assert.equal(price.kind, "price");
assert.deepEqual(price.card.keyframes, [{ index: 0, words: "What if", path: "u/job/a.png", garbled: false, credits: 2 }]);
assert.deepEqual([price.card.shots, price.card.seconds], [2, 10]);
assert.doesNotMatch(JSON.stringify(price.card), /signed\.example/);
PriceSnapshotSchema.parse({ kind: "price", step_id: "s", clip_id: "c", tool: "animate_video", price_credits: 80, ...price.card });

const id = renderRequestId("short", "a".repeat(64));
assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.equal(id, renderRequestId("short", "a".repeat(64)), "one render per short and document");
assert.notEqual(id, renderRequestId("short", "b".repeat(64)));

console.log("studio adapter: access, brief, cards and render ids correct");
