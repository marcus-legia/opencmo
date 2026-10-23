/**
 * Stage 2 of a long take and redoing a keyframe (`long-take.ts`), on the fake catalog: shots start
 * and end on the right keyframes, a missing keyframe is refused before anything is priced, the
 * same request gives the same specs (one payment), a redone keyframe changes only its shots.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/agent/long-take.check.ts
 */
import assert from "node:assert/strict";

import { applyOps, keyframesOf, type KeyframeSource, type OpContext } from "@opencmo/editor-core";
import type { ClipDocument } from "@opencmo/clip-doc";

import { priceOf } from "@opencmo/editor-core/generate";

import { normalizeSpec } from "@/lib/generate/create";
import { availableModel } from "@/lib/generate/models";

import { review, shotPrompts } from "./create-video";
import { prepareAnimateVideo, prepareRedoKeyframe, redescribe, runRedoKeyframe, type KeyframeFile } from "./long-take";

const blank = () =>
  ({ version: 1, stage: { children: [{ kind: "scene", id: "sc", name: "Edit", width: 1920, height: 1080, active: true, children: [] }] } }) as unknown as ClipDocument;
const ctx = { media: { duration: () => null }, readTranscript: async () => [], saveTranscript: async () => "x" } as unknown as OpContext;

const OWNER = "00000000-0000-4000-8000-000000000000";
const id = (index: number) => `00000000-0000-4000-8000-00000000000${index}`;
const source = (index: number, aspectRatio = "16:9"): KeyframeSource => ({ generate: "image", prompt: `Keyframe ${index} subject. Cinematic look.`, model: "fake-image", aspectRatio, seed: 10 + index });
const file = (index: number, aspectRatio?: string): KeyframeFile => ({ source: source(index, aspectRatio), path: `${OWNER}/keyframes/${index}.png`, garbled: index === 2 });

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
const keyframes = [0, 1, 2].map((index) => ({ generation_id: id(index), index }));
const reader = (files: Record<string, KeyframeFile>) => async (ids: string[]) => new Map(ids.filter((key) => files[key]).map((key) => [key, files[key]!]));
const all = { [id(0)]: file(0), [id(1)]: file(1), [id(2)]: file(2) };
const env = (files: Record<string, KeyframeFile> = all) => ({ document: blank(), readKeyframes: reader(files), sign: async (paths: string[]) => paths.map((path) => `https://signed/${path}`) });

type Shot = { start_frame?: KeyframeSource; end_frame?: KeyframeSource; seed: number };

async function main() {
  process.env.OPENCMO_AI_FAKE = "1";

  // 1. Shots between keyframes: continuous shots carry both frames, the cut shot only its first.
  const made = await prepareAnimateVideo({ plan, aspect: "16:9", keyframes }, env());
  assert.ok(typeof made !== "string", `a good plan is priced: ${String(made)}`);
  const specs = [made.prepared.spec, ...made.prepared.extra!.filter((item) => item.model.kind === "video").map((item) => item.spec)];
  assert.deepEqual(
    specs.map((spec) => [spec.startImage, spec.endImage]),
    [[file(0).path, file(1).path], [file(1).path, file(2).path], [file(2).path, undefined]],
  );
  const op = made.prepared.op as unknown as { title: string; seconds: number; shots: Shot[] };
  assert.equal(op.title, "Front desk");
  assert.equal(op.seconds, 13);
  assert.deepEqual(op.shots.map((shot) => [shot.start_frame?.seed, shot.end_frame?.seed]), [[10, 11], [11, 12], [12, undefined]]);
  // The declaration a shot names is the keyframe's own spec: the editor's request hashes to the paid generation.
  assert.deepEqual(normalizeSpec(availableModel("fake-image")!, { prompt: source(1).prompt, aspectRatio: "16:9", seed: 11 }), { prompt: source(1).prompt, aspectRatio: "16:9", seed: 11 });
  // Stage 1 priced and moderated these exact prompts.
  assert.deepEqual(specs.map((spec) => spec.prompt), shotPrompts(plan as never, made.prepared.model, "16:9", true).map((shot) => shot.prompt));
  assert.equal(made.sheet.tiles.length, 3);
  assert.deepEqual(made.sheet.tiles.map((tile) => [tile.words, tile.garbled]), [[plan.shots[0]!.words, false], [plan.shots[1]!.words, false], [plan.shots[2]!.words, true]]);
  assert.ok(made.sheet.tiles.every((tile) => tile.credits > 0 && tile.url?.startsWith("https://signed/")));
  assert.match(made.prepared.lines![0]!, /^Animate a 13s 16:9 video: 3 shots on 3 keyframes, voice-over \(.+\), music · \d+ credits/);
  assert.ok(made.prepared.lines!.some((line) => /Keyframe 3 may have garbled text/.test(line)));
  const pieces = [{ model: made.prepared.model, spec: made.prepared.spec }, ...made.prepared.extra!];
  assert.equal(made.prepared.credits, pieces.reduce((sum, item) => sum + priceOf(item.model, item.spec), 0), "the card's price is every shot, the voice and the music");
  assert.ok(!made.prepared.lines!.some((line) => /fake-video|Veo|Kling|Seedance/i.test(line.replace(/^Shots on [^·]+/, ""))), "no model name outside the tier line");
  assert.deepEqual(made.pieces.map((piece) => piece.label.split(" (")[0]), ["Shot 1", "Shot 2", "Shot 3", "The voice-over script", "The music"]);

  // 2. One payment: the same request gives the same specs, so the server reuses the generations.
  const again = await prepareAnimateVideo({ plan, aspect: "16:9", keyframes }, env());
  assert.ok(typeof again !== "string");
  assert.deepEqual([again.prepared.spec, ...again.prepared.extra!.map((item) => item.spec)], [made.prepared.spec, ...made.prepared.extra!.map((item) => item.spec)]);

  // 3. A redone keyframe 1 changes shots 1 and 2 only; shot 3 keeps its spec.
  const redone = await prepareAnimateVideo(
    { plan, aspect: "16:9", keyframes: keyframes.map((item) => (item.index === 1 ? { ...item, generation_id: id(5) } : item)) },
    env({ ...all, [id(5)]: { ...file(1), source: { ...source(1), seed: 99 }, path: `${OWNER}/keyframes/1b.png` } }),
  );
  assert.ok(typeof redone !== "string");
  const redoneSpecs = [redone.prepared.spec, ...redone.prepared.extra!.filter((item) => item.model.kind === "video").map((item) => item.spec)];
  assert.deepEqual(redoneSpecs.map((spec, index) => JSON.stringify(spec) !== JSON.stringify(specs[index])), [true, true, false]);

  // 4. Refused before anything is priced: a keyframe that is not done or whose file is gone, or the wrong frame.
  const { [id(1)]: _gone, ...missing } = all;
  assert.equal(await prepareAnimateVideo({ plan, aspect: "16:9", keyframes }, env(missing)), "Keyframe 2 is missing. Redo it first.");
  assert.equal(await prepareAnimateVideo({ plan, aspect: "16:9", keyframes }, env({ ...all, [id(0)]: file(0, "9:16") })), "Keyframe 1 is 9:16; this video is 16:9. Redo it first.");
  assert.match(String(await prepareAnimateVideo({ plan, aspect: "16:9", keyframes: keyframes.slice(0, 2) }, env())), /keyframes 0 to 2, each once/);
  const trimmed = { ...plan, shots: [{ ...plan.shots[0]!, seconds: 4 }, ...plan.shots.slice(1)] };
  assert.match(String(await prepareAnimateVideo({ plan: trimmed, aspect: "16:9", keyframes }, env())), /Shot 1 is 4s but ends on keyframe 2, so it must be exactly one of 3, 5s/);

  // 5. Placed: one scene; redoing keyframe 1 prices one image and exactly the two shots on it.
  const placed = await applyOps(blank(), [made.prepared.op as never], ctx);
  const scene = (placed.document.stage.children[0] as unknown as { children: { kind: string; id: string; name: string; children?: { id: string }[] }[] }).children.find((node) => node.kind === "sequence")!;
  assert.equal(scene.name, "Front desk");
  assert.equal(keyframesOf(placed.document, scene.id)!.length, 3);
  const redo = prepareRedoKeyframe({ scene_id: scene.id, index: 1, keyframe: "the same guest, now smiling" }, placed.document);
  assert.ok(typeof redo !== "string", String(redo));
  assert.deepEqual(redo.shots.map((shot) => [shot.elementId, shot.start, shot.end]), [[scene.children![0]!.id, false, true], [scene.children![1]!.id, true, false]]);
  assert.equal(redo.op.keyframe.prompt, "The same guest, now smiling. Cinematic look.");
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
    from: () => ({ select: () => ({ in: async () => ({ count: 23 }) }) }),
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
  assert.match(capped.outcome.summary, /needs 3 generations at once and 23 are still running/);
  assert.equal(created, 0, "nothing was created or held");

  assert.equal(redescribe("Old subject, warm light. Cinematic look. No text.", "a new subject."), "A new subject. Cinematic look. No text.");
  assert.equal(redescribe("A desk at 9 a.m. in a lobby. Cinematic look.", "a guest smiling"), "A guest smiling. Cinematic look.", "a period inside the old description");
  assert.equal(redescribe("A 3.5-inch phone on a desk. Cinematic look.", "a coffee cup"), "A coffee cup. Cinematic look.");

  // 6. A continuous last shot ends on the closing keyframe, which no shot starts from: it may stop short.
  const closing = { ...plan, shots: [plan.shots[0]!, { ...plan.shots[1]!, continues: false }, { ...plan.shots[2]!, seconds: 2, continues: true }] };
  const closingKeyframes = [0, 1, 2, 3].map((index) => ({ generation_id: id(index), index }));
  const closed = await prepareAnimateVideo({ plan: closing, aspect: "16:9", keyframes: closingKeyframes }, env({ ...all, [id(3)]: file(3) }));
  assert.ok(typeof closed !== "string", `a short continuous last shot is fine: ${String(closed)}`);

  // Without a model that joins two frames every beat is a cut: no exact-length rule for a seam that never joins.
  assert.ok(review(trimmed as never, 12, [3, 5], true).some((issue) => /flows into the next/.test(issue)));
  assert.ok(!review(trimmed as never, 12, [3, 5], false).some((issue) => /flows into the next/.test(issue)));

  // 7. Stage 2 makes the shots on the model stage 1 priced (named by the user or picked), not today's default.
  const named = await prepareAnimateVideo({ plan, aspect: "16:9", keyframes, model: "fake-video" }, env());
  assert.ok(typeof named !== "string");
  assert.equal(named.prepared.model.id, "fake-video");
  assert.match(String(await prepareAnimateVideo({ plan, aspect: "16:9", keyframes, model: "no-such-model" }, env())), /cannot make 16:9 video shots/);
  console.log("long-take: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
