/**
 * A long take (`create_video` in one go, then `redo_keyframe`), on the fake catalog: shots start and
 * end on the right keyframes, a cut shot has no end frame, the card prices every piece, and a redone
 * keyframe changes only its shots.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/agent/long-take.check.ts
 */
import assert from "node:assert/strict";

import { applyOps, keyframesOf, type KeyframeSource, type OpContext } from "@opencmo/editor-core";
import type { ClipDocument } from "@opencmo/clip-doc";

import { priceOf } from "@opencmo/editor-core/generate";

import { specHash } from "@/lib/generate/models";

import { prepareCreateVideo, review, shotPrompts } from "./create-video";
import { prepareRedoKeyframe, redescribe, runRedoKeyframe } from "./long-take";

const blank = () =>
  ({ version: 1, stage: { children: [{ kind: "scene", id: "sc", name: "Edit", width: 1920, height: 1080, active: true, children: [] }] } }) as unknown as ClipDocument;
const ctx = { media: { duration: () => null }, readTranscript: async () => [], saveTranscript: async () => "x" } as unknown as OpContext;

const id = (index: number) => `00000000-0000-4000-8000-00000000000${index}`;

// Shots 1 and 2 join keyframes 0→1→2; shot 3 is a cut on keyframe 2.
const plan = {
  title: "Front desk",
  script: "Your front desk opens itself. Guests check in from their phone. You get your morning back.",
  style: "cinematic",
  music: "warm acoustic, mid tempo",
  shots: [
    { seconds: 5, words: "Your front desk opens itself.", keyframe: "an empty hotel lobby at dawn", motion: "slow push-in, lights warm up", continues: true, text: "Meet your front desk" },
    { seconds: 5, words: "Guests check in from their phone.", keyframe: "a guest at the desk holding a phone", motion: "orbit around the guest", continues: true },
    { seconds: 3, words: "You get your morning back.", keyframe: "an owner with coffee by the window", motion: "handheld, steam rises", continues: false },
  ],
};
const make = (extra: Record<string, unknown> = {}, given: typeof plan = plan) =>
  prepareCreateVideo({ prompt: "a front desk video", aspect: "16:9", plan: given, ...extra }, { document: blank() }, async () => undefined);

type Shot = { start_frame?: KeyframeSource; end_frame?: KeyframeSource; seed: number };

async function main() {
  process.env.OPENCMO_AI_FAKE = "1";

  // 1. Shots between keyframes: continuous shots wait for both frames, the cut shot only its first.
  const made = await make();
  assert.ok(typeof made !== "string", `a good plan is priced: ${String(made)}`);
  const runs = [{ model: made.prepared.model, spec: made.prepared.spec }, ...made.prepared.extra!];
  const keyframes = runs.filter((run) => run.model.kind === "image");
  const shots = runs.filter((run) => run.model.kind === "video");
  assert.equal(keyframes.length, 3);
  const hashes = keyframes.map((run) => specHash(run.model.id, run.spec));
  assert.deepEqual(
    shots.map((run) => [run.spec.startAfter, run.spec.endAfter]),
    [[hashes[0], hashes[1]], [hashes[1], hashes[2]], [hashes[2], undefined]],
  );
  assert.ok(shots.every((run) => run.spec.startImage === undefined && run.spec.endImage === undefined), "no file exists yet: shots name the keyframes by hash");
  const op = made.prepared.op as unknown as { title: string; seconds: number; shots: Shot[] };
  assert.equal(op.title, "Front desk");
  assert.equal(op.seconds, 13);
  // The scene names each keyframe by the spec it is made with, so the editor finds the same generation.
  assert.deepEqual(
    op.shots.map((shot) => [shot.start_frame?.seed, shot.end_frame?.seed]),
    [[keyframes[0]!.spec.seed, keyframes[1]!.spec.seed], [keyframes[1]!.spec.seed, keyframes[2]!.spec.seed], [keyframes[2]!.spec.seed, undefined]],
  );
  assert.deepEqual(op.shots.map((shot) => shot.seed), shots.map((run) => run.spec.seed), "the scene declares the shots that were priced");
  assert.deepEqual(shots.map((run) => run.spec.prompt), shotPrompts(plan as never, shots[0]!.model, "16:9", true).map((shot) => shot.prompt));
  assert.match(made.prepared.lines![0]!, /^Create a 13s 16:9 video: 3 shots on 3 keyframes, voice-over \(.+\), music · \d+ credits/);
  assert.equal(made.prepared.credits, runs.reduce((sum, item) => sum + priceOf(item.model, item.spec), 0), "the card's price is every keyframe, shot, the voice and the music");
  assert.ok(!made.prepared.lines!.some((line) => /fake-video|fake-image|Veo|Kling|Seedance/i.test(line)), "no model name on the card");
  assert.deepEqual(made.later.map((piece) => piece.label.split(" (")[0]), ["Shot 1", "Shot 2", "Shot 3", "The voice-over script", "The music"]);

  // 2. Refused before anything is priced: a shot that must flow into the next keyframe but is too short.
  const trimmed = { ...plan, shots: [{ ...plan.shots[0]!, seconds: 4 }, ...plan.shots.slice(1)] };
  assert.match(String(await make({}, trimmed)), /Shot 1 .*flows into the next, so it must be exactly one of 3, 5s/);

  // 3. Placed: one scene; redoing keyframe 1 prices one image and exactly the two shots on it.
  const placed = await applyOps(blank(), [made.prepared.op as never], ctx);
  const source = (index: number): KeyframeSource => op.shots[index]!.start_frame!;
  const scene = (placed.document.stage.children[0] as unknown as { children: { kind: string; id: string; name: string; children?: { id: string }[] }[] }).children.find((node) => node.kind === "sequence")!;
  assert.equal(scene.name, "Front desk");
  assert.equal(keyframesOf(placed.document, scene.id)!.length, 3);
  const redo = prepareRedoKeyframe({ scene_id: scene.id, index: 1, keyframe: "the same guest, now smiling" }, placed.document);
  assert.ok(typeof redo !== "string", String(redo));
  assert.deepEqual(redo.shots.map((shot) => [shot.elementId, shot.start, shot.end]), [[scene.children![0]!.id, false, true], [scene.children![1]!.id, true, false]]);
  assert.match(redo.op.keyframe.prompt, /^The same guest, now smiling\. /, "the new description opens the prompt; the look stays");
  assert.ok(redo.op.keyframe.prompt.endsWith(source(1).prompt.slice(source(1).prompt.search(/\.\s+[A-Z]/) + 2)));
  assert.notEqual(redo.op.keyframe.seed, source(1).seed);
  assert.match(redo.lines[0]!, /^Redo keyframe 2: a new image and 2 shots · \d+ credits$/);
  const first = prepareRedoKeyframe({ scene_id: scene.id, index: 0 }, placed.document);
  assert.ok(typeof first !== "string");
  assert.equal(first.shots.length, 1, "the first keyframe is only the first shot's");
  assert.equal(first.op.keyframe.prompt, source(0).prompt, "no new description keeps the prompt; only the seed changes");
  assert.match(String(prepareRedoKeyframe({ scene_id: scene.id, index: 3 }, placed.document)), /there is no keyframe 3/);
  assert.match(String(prepareRedoKeyframe({ scene_id: "sc", index: 0 }, placed.document)), /not a long-take scene/);
  const applied = await applyOps(placed.document, [redo.op as never], ctx);
  assert.equal(keyframesOf(applied.document, scene.id)![1]!.source.prompt, redo.op.keyframe.prompt);

  // With the in-flight cap reached, redo_keyframe refuses before the keyframe is paid for.
  let created = 0;
  const busy = {
    from: () => ({ select: () => ({ in: async () => ({ count: 39 }) }) }),
    rpc: async () => {
      created += 1;
      return { data: null, error: null };
    },
  };
  const capped = await runRedoKeyframe(
    { supabase: busy as never, jobId: id(7), clipId: id(8), applyOp: async () => ({ ok: true, content: "{}", summary: "" }), addToLibrary: async () => {} },
    redo,
  );
  assert.equal(capped.outcome.ok, false);
  assert.match(capped.outcome.summary, /needs 3 generations at once and 39 are still running/);
  assert.equal(created, 0, "nothing was created or held");

  assert.equal(redescribe("Old subject, warm light. Cinematic look. No text.", "a new subject."), "A new subject. Cinematic look. No text.");
  assert.equal(redescribe("A desk at 9 a.m. in a lobby. Cinematic look.", "a guest smiling"), "A guest smiling. Cinematic look.", "a period inside the old description");
  assert.equal(redescribe("A 3.5-inch phone on a desk. Cinematic look.", "a coffee cup"), "A coffee cup. Cinematic look.");

  // 4. A continuous last shot ends on the closing keyframe, which no shot starts from: it may stop short.
  const closing = { ...plan, shots: [plan.shots[0]!, { ...plan.shots[1]!, continues: false }, { ...plan.shots[2]!, seconds: 2, continues: true }] };
  const closed = await make({ seconds: 12 }, closing);
  assert.ok(typeof closed !== "string", `a short continuous last shot is fine: ${String(closed)}`);
  assert.equal(closed.prepared.library!.names.length, 4, "a closing keyframe after the last shot");

  // Without a model that joins two frames every beat is a cut: no exact-length rule for a seam that never joins.
  assert.ok(review(trimmed as never, 12, [3, 5], true).some((issue) => /flows into the next/.test(issue)));
  assert.ok(!review(trimmed as never, 12, [3, 5], false).some((issue) => /flows into the next/.test(issue)));

  // 5. The shots are made on the model the user named, and a model this frame cannot use is refused.
  const named = await make({ model: "fake-video" });
  assert.ok(typeof named !== "string");
  assert.ok(named.prepared.extra!.some((item) => item.model.id === "fake-video"));
  assert.match(String(await make({ model: "no-such-model" })), /cannot make 16:9 video shots/);
  console.log("long-take: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
