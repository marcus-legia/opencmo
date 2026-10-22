/**
 * Explainer v2 storyboard (`docs/explainer-v2-build.md`, C1/C3/C4): `visual` per beat stays out of
 * the job and the spec, `theme` / `personality` go into both, the card lists the pictures, the
 * preview result asks for the subject check, and the editor finds explainers without captions.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/agent/explainer-tool.check.ts
 */
import assert from "node:assert/strict";

import type { ClipDocument } from "@opencmo/clip-doc";

import { uncaptionedExplainers } from "../../components/editor/generate/useExplainers";
import { VACCINE_EXPLAINER } from "./providers/fake-explainers";
import { z } from "zod";

import {
  explainerCard,
  explainerToolSpecs,
  prepareExplainer,
  PREVIEW_ROUNDS,
  previewExplainerInput,
  previewJob,
  REVIEW_CHECKLIST,
  runPreviewExplainer,
  SUBJECT_CHECK,
  type MotionJob,
} from "./explainer-tool";

async function main() {
  process.env.OPENCMO_AI_FAKE = "1";
  const input = { ...VACCINE_EXPLAINER };

  // The preview job: spec beats only, the look the model chose.
  const job = previewJob(input);
  assert.equal(job.theme, "paper");
  assert.equal(job.personality, "playful");
  assert.ok(job.beats.every((beat) => !("visual" in beat)), "visual must not reach the render job");
  assert.deepEqual(job.beats[0], { say: input.beats[0]!.say, label: input.beats[0]!.label });
  const plain = previewJob({ ...input, theme: undefined, personality: undefined });
  assert.ok(!("theme" in plain) && !("personality" in plain), "a v1 look leaves the fields out");

  // The preview result carries the storyboard and the subject check.
  let seen: MotionJob | null = null;
  const outcome = await runPreviewExplainer(input, {
    preview: async (sent) => {
      seen = sent;
      return { ok: true, stills: [{ t: 1, file: "a.jpg" }], issues: [], estimated: true, images: ["AAAA"] };
    },
  });
  assert.equal(outcome.ok, true);
  const content = JSON.parse(outcome.content) as { check?: string; storyboard?: string[] };
  assert.equal(content.check, SUBJECT_CHECK);
  assert.equal(content.storyboard?.[0], `beat 1: ${input.beats[0]!.visual}`);
  assert.equal(seen!.theme, "paper");

  // A beat without a picture is refused before anything renders.
  const missing = await runPreviewExplainer({ ...input, beats: input.beats.map(({ visual: _visual, ...beat }) => beat) }, {
    preview: async () => assert.fail("must not render"),
  });
  assert.equal(missing.ok, false);
  assert.match(missing.content, /visual/);

  // The spec: theme and personality in, visual out; the card shows the pictures and the look.
  const prepared = await prepareExplainer(
    { ...input, voice: "Aria" },
    { previewed: async () => [input.code], save: async () => "a".repeat(64) },
  );
  assert.ok(typeof prepared !== "string", String(prepared));
  const scene = prepared.spec.scene as { theme?: string; personality?: string; beats: Record<string, unknown>[] };
  assert.equal(scene.theme, "paper");
  assert.equal(scene.personality, "playful");
  assert.ok(scene.beats.every((beat) => !("visual" in beat)), "visual must not reach the spec");
  const card = explainerCard(prepared, "clip");
  assert.match(card.changes[0]!, / · paper, playful · voice Aria · /);
  assert.match(card.changes[1]!, /· Picture: a syringe icon slides in from the left/);

  // A3: a numeric direction first, previews at chosen times, the review checklist with every clean preview.
  const noDirection = await runPreviewExplainer({ ...input, direction: undefined }, { preview: async () => assert.fail("must not render") });
  assert.equal(noDirection.ok, false);
  assert.match(noDirection.content, /direction: missing\. Before the code, write the motion direction/, "an old client gets one message naming direction and what to write");
  const short = await runPreviewExplainer({ ...input, direction: "x".repeat(119) }, { preview: async () => assert.fail("must not render") });
  assert.equal(short.ok, false);
  assert.match(short.content, /direction: too short/);
  let timed: MotionJob | null = null;
  const reviewed = await runPreviewExplainer({ ...input, times: [2, 2, 99] }, {
    preview: async (sent) => {
      timed = sent;
      return { ok: true, stills: [{ t: 2, file: "a.jpg" }], issues: [], estimated: true, images: ["AAAA"] };
    },
  });
  assert.deepEqual(timed!.stills, [2, 2, 99], "times reach clip-motion as stills; it clamps and dedupes");
  assert.ok(!("stills" in previewJob(input)), "no times: the default stills");
  const review = JSON.parse(reviewed.content) as { review?: string; rounds?: string };
  assert.equal(review.review, REVIEW_CHECKLIST);
  assert.equal(PREVIEW_ROUNDS, 6);
  assert.match(review.rounds ?? "", /Up to 6 previews/);
  assert.match(REVIEW_CHECKLIST, /Name the one worst problem you see, fix only that, and preview again; stop when a round finds nothing\.$/);
  const tooMany = await runPreviewExplainer({ ...input, times: Array.from({ length: 13 }, (_, i) => i) }, { preview: async () => assert.fail("must not render") });
  assert.match(tooMany.content, /times/);
  const keys = Object.keys((z.toJSONSchema(previewExplainerInput, { io: "input" }) as { properties: Record<string, unknown> }).properties);
  assert.ok(keys.indexOf("direction") >= 0 && keys.indexOf("direction") < keys.indexOf("code"), "direction is written before code");
  const toolSchema = explainerToolSpecs().find((spec) => spec.name === "preview_explainer")!.schema as { properties: Record<string, unknown>; required: string[] };
  assert.ok(toolSchema.required.includes("direction"));
  assert.ok(Object.keys(toolSchema.properties).indexOf("direction") < Object.keys(toolSchema.properties).indexOf("code"));
  assert.match(explainerToolSpecs().find((spec) => spec.name === "preview_explainer")!.description, /up to 6 rounds/);

  // The editor captions explainers that have no captions layer yet, and only those.
  const explainer = (id: string) => ({
    kind: "rect",
    id,
    paints: [{ type: "video", src: { generate: "video", model: "motion-explainer", prompt: "Explainer: x" } }],
  });
  const document = {
    version: 1,
    stage: {
      children: [
        {
          kind: "scene",
          children: [
            explainer("a"),
            explainer("b"),
            { kind: "rect", id: "c", paints: [{ type: "video", src: { generate: "video", model: "kling", prompt: "x" } }] },
            { kind: "captions", source: "b", src: "assets/transcripts/x.json" },
          ],
        },
      ],
    },
  } as unknown as ClipDocument;
  assert.deepEqual(
    uncaptionedExplainers(document).map((item) => item.elementId),
    ["a"],
  );

  console.log("explainer-tool.check: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
