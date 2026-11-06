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
  openExplainerOrder,
  PLAN_FIRST,
  planExplainerCard,
  prepareExplainer,
  preparePlanExplainer,
  runAddExplainer,
  runPlanExplainer,
  PREVIEW_ROUNDS,
  previewExplainerInput,
  previewJob,
  REVIEW_CHECKLIST,
  runMotionTemplateTool,
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
  assert.match(card.changes[1]!, /· Picture: a drawn syringe slides in from the left/);

  // Charge before running (D9): the storyboard is priced before any code, at the price the render will have.
  const { code: _planCode, ...storyboard } = input;
  const planned = preparePlanExplainer({ ...storyboard, voice: "Aria" });
  assert.ok(typeof planned !== "string", String(planned));
  assert.equal(planned.credits, prepared.credits, "the plan's price is the render add_explainer starts");
  assert.match(preparePlanExplainer({ ...storyboard }) as string, /^voice: choose one of/);
  const planCard = planExplainerCard(planned, "clip", 20);
  assert.match(planCard.changes[0]!, /^Explainer “.+” · \d+s · .+ · paper, playful · voice Aria · up to \d+ credits$/);
  assert.equal(planCard.credits, planned.credits + 20, "the card shows the render and the code allowance");
  assert.match(planCard.changes[1]!, /^Render · \d+ credits · writing and checking the animation · billed as used, up to 20 credits$/);
  assert.ok(planCard.changes.some((line) => /Picture: a drawn syringe slides in from the left/.test(line)), "the pictures are on the one card");
  const specs = explainerToolSpecs();
  assert.equal(specs.find((spec) => spec.name === "plan_explainer")?.approval, true, "the plan is the card");
  assert.ok(!specs.find((spec) => spec.name === "add_explainer")?.approval, "add_explainer asks again for nothing");

  // A fake database: open jobs, and what each RPC was asked. Reads filter like PostgREST: only the eq/is columns given.
  const jobs: { id: string; estimate_credits: number; open: boolean; subject: string; source_kind: string; source_id: string | null }[] = [];
  const rpcs: string[] = [];
  const db = {
    from: () => {
      const where: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => ((where[column] = value), query),
        is: (column: string, value: unknown) => ((where[column] = value), query),
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          const match = (job: (typeof jobs)[number]) =>
            job.open &&
            Object.entries(where).every(([column, value]) => ["kind", "status"].includes(column) || (job as Record<string, unknown>)[column] === value);
          return { data: [...jobs].reverse().find(match) ?? null, error: null };
        },
      };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push(name);
      if (name === "credit_order_open") {
        jobs.push({
          id: `job-${jobs.length + 1}`,
          estimate_credits: Number(args.p_estimate),
          open: true,
          subject: String(args.p_subject),
          source_kind: String(args.p_source_kind),
          source_id: (args.p_source_id as string | null) ?? null,
        });
        return { data: { id: jobs.at(-1)!.id }, error: null };
      }
      if (name === "credit_order_close") {
        for (const job of jobs) if (job.id === args.p_order_id) job.open = false;
        return { data: 0, error: null };
      }
      return { data: null, error: null };
    },
  };
  const turn = { kind: "agent_turn" as const, id: "turn-1" };
  const env = { supabase: db as never, jobId: "j", clipId: "c", source: turn, applyOp: async () => ({ ok: true, content: "{}", summary: "" }) };
  const refused = await runAddExplainer(env, prepared);
  assert.equal(refused.ok, false);
  assert.match(refused.content, new RegExp(PLAN_FIRST.slice(0, 40)));
  const approved = await runPlanExplainer({ supabase: db as never, clipId: "c", source: turn }, planned, "00000000-0000-4000-8000-000000000001");
  assert.ok(approved.ok, approved.content);
  assert.equal(jobs[0]!.estimate_credits, planned.credits, "one job holds the render price");
  assert.equal(jobs[0]!.subject, "clip:c", "the job names the clip it was approved for");
  // Review 2026-11-06: an approval is not a blank cheque for another clip or another conversation.
  assert.equal(await openExplainerOrder(db as never, { clipId: "other", source: turn }), null, "another clip cannot draw from it");
  assert.equal(await openExplainerOrder(db as never, { clipId: "c", source: { kind: "agent_turn", id: "turn-2" } }), null, "nor another turn");
  assert.equal(await openExplainerOrder(db as never, { clipId: "c", source: { kind: "mcp", id: null } }), null, "nor MCP");
  assert.equal((await openExplainerOrder(db as never, { clipId: "c", source: turn }))?.id, "job-1", "its own clip and turn can");
  await runPlanExplainer({ supabase: db as never, clipId: "other", source: turn }, planned, "00000000-0000-4000-8000-000000000003");
  assert.deepEqual(jobs.map((job) => job.open), [true, true], "approving another clip's plan leaves this one's hold alone");
  await runPlanExplainer({ supabase: db as never, clipId: "c", source: turn }, planned, "00000000-0000-4000-8000-000000000002");
  assert.deepEqual(jobs.map((job) => job.open), [false, true, true], "a plan approved again here gives the old hold back first");
  // The card quotes the Assistant's writing only where it is billed (the editor), never over MCP.
  assert.equal(planExplainerCard(planned, "c").credits, planned.credits, "MCP: the render alone");
  assert.equal(planExplainerCard(planned, "c", 20).credits, planned.credits + 20, "editor: render plus the capped writing");
  assert.doesNotMatch(planExplainerCard(planned, "c").changes[1]!, /writing/);

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
  const looked = previewJob({ ...input, sheet: { from: 1, to: 2, count: 6 }, zoom: { t: 2, x: 0, y: 0, w: 400, h: 200 } });
  assert.deepEqual([looked.sheet, looked.zoom], [{ from: 1, to: 2, count: 6 }, { t: 2, x: 0, y: 0, w: 400, h: 200 }], "the sheet and the zoom reach the job");
  assert.ok(!previewExplainerInput.safeParse({ ...input, sheet: { from: 2, to: 1, count: 4 } }).success, "a sheet runs forward");
  // Style directions (plan O5): variants instead of code, the first one's code fills the job's.
  const { code: _code, ...noCode } = input;
  const directions = previewExplainerInput.parse({ ...noCode, variants: [{ label: "A", code: input.code }, { label: "B", code: `${input.code}\n` }] });
  const directed = previewJob(directions);
  assert.equal(directed.code, input.code);
  assert.deepEqual(directed.variants?.map((variant) => variant.label), ["A", "B"]);
  assert.ok(!previewExplainerInput.safeParse(noCode).success, "a preview needs code or variants");
  assert.ok(!previewExplainerInput.safeParse({ ...noCode, variants: [{ label: "A", code: input.code }] }).success, "two directions at least");
  const sheetOf = await runPreviewExplainer(directions, {
    preview: async () => ({ ok: true, stills: [{ t: 1, file: "variants.jpg", kind: "variants", labels: ["A", "B"] }], issues: [], estimated: true, images: ["AAAA"] }),
  });
  assert.ok(sheetOf.ok && sheetOf.images?.length === 1);
  assert.match(sheetOf.content, /left to right: A, B/);
  assert.match(sheetOf.content, /ask_user/);
  assert.doesNotMatch(sheetOf.content, /review/, "no review rounds before a direction is picked");
  const review = JSON.parse(reviewed.content) as { review?: string; rounds?: string };
  assert.equal(review.review, REVIEW_CHECKLIST);
  assert.equal(PREVIEW_ROUNDS, 6);
  assert.match(review.rounds ?? "", /Up to 6 previews/);
  assert.match(REVIEW_CHECKLIST, /\n2\. Drawing: is the subject drawn as itself .*not a stock icon in a ring or a medallion\?\n3\. Direction/, "the review asks for a drawn subject");
  assert.match(REVIEW_CHECKLIST, /Name the one worst problem you see, fix only that, and preview again; stop when a round finds nothing\.$/);
  const tooMany = await runPreviewExplainer({ ...input, times: Array.from({ length: 13 }, (_, i) => i) }, { preview: async () => assert.fail("must not render") });
  assert.match(tooMany.content, /times/);
  const keys = Object.keys((z.toJSONSchema(previewExplainerInput, { io: "input" }) as { properties: Record<string, unknown> }).properties);
  assert.ok(keys.indexOf("direction") >= 0 && keys.indexOf("direction") < keys.indexOf("code"), "direction is written before code");
  const toolSchema = explainerToolSpecs().find((spec) => spec.name === "preview_explainer")!.schema as { properties: Record<string, unknown>; required: string[] };
  assert.ok(toolSchema.required.includes("direction"));
  assert.ok(Object.keys(toolSchema.properties).indexOf("direction") < Object.keys(toolSchema.properties).indexOf("code"));
  assert.match(explainerToolSpecs().find((spec) => spec.name === "preview_explainer")!.description, /up to 6 rounds/);

  // A5: images from the user's library. An unknown path is refused before any preview; a known one reaches the
  // preview as a signed URL and the spec as the library object only.
  const OBJECT = "11111111-1111-4111-8111-111111111111/j/screen.png";
  const lookupImage = async (paths: readonly string[]) => paths.map((path) => (path === "Uploads/screen.png" ? OBJECT : null));
  const signAssets = async (refs: { name: string; ref: string }[]) => refs.map((ref) => ({ name: ref.name, src: `https://project.supabase.co/storage/v1/object/sign/media/${ref.ref}?token=t` }));
  const withImage = { ...input, assets: [{ name: "screen", image: "Uploads/screen.png" }] };
  const unknown = await runPreviewExplainer({ ...input, assets: [{ name: "screen", image: "Uploads/nope.png" }] }, {
    preview: async () => assert.fail("must not render"),
    lookupImage,
    signAssets,
  });
  assert.equal(unknown.ok, false);
  assert.match(unknown.content, /assets\.0\.image: \\"Uploads\/nope\.png\\" is not an image saved to the cloud yet/);
  let withAssets: MotionJob | null = null;
  const shown = await runPreviewExplainer(withImage, {
    preview: async (sent) => {
      withAssets = sent;
      return { ok: true, stills: [{ t: 1, file: "a.jpg" }], issues: [], estimated: true, images: ["AAAA"] };
    },
    lookupImage,
    signAssets,
  });
  assert.equal(shown.ok, true);
  assert.deepEqual(withAssets!.assets, [{ name: "screen", src: `https://project.supabase.co/storage/v1/object/sign/media/${OBJECT}?token=t` }]);
  const badName = await runPreviewExplainer({ ...input, assets: [{ name: "Screen", image: "Uploads/screen.png" }] }, { preview: async () => assert.fail("must not render"), lookupImage, signAssets });
  assert.match(badName.content, /assets\.0\.name/);
  const withRefs = await prepareExplainer({ ...withImage, voice: "Aria" }, { previewed: async () => [input.code], save: async () => "a".repeat(64), lookupImage });
  assert.ok(typeof withRefs !== "string", String(withRefs));
  assert.deepEqual((withRefs.spec.scene as { assets?: unknown }).assets, [{ name: "screen", ref: OBJECT }], "the spec holds the library object, never a URL");
  assert.match(explainerCard(withRefs, "clip").changes[1]!, /Images from your media: Uploads\/screen\.png/);
  const missingRef = await prepareExplainer({ ...input, voice: "Aria", assets: [{ name: "screen", image: "Uploads/nope.png" }] }, { previewed: async () => [input.code], save: async () => assert.fail("must not save"), lookupImage });
  assert.match(String(missingRef), /^assets\.0\.image: /);

  // B3: silent motion clips. Timed beats, kind "clip", no voice, model motion-clip, a card without narration.
  const silentBeats = [
    { say: "The mark lands.", visual: "the tile settles", seconds: 2 },
    { say: "The name rises.", label: "OpenCMO", visual: "the name rises letter by letter", seconds: 2.5 },
  ];
  const silentInput = { ...input, silent: true, beats: silentBeats };
  let silentJob: MotionJob | null = null;
  const silentPreview = await runPreviewExplainer(silentInput, {
    preview: async (sent) => {
      silentJob = sent;
      return { ok: true, stills: [{ t: 1, file: "a.jpg" }], issues: [], estimated: false, images: ["AAAA"] };
    },
  });
  assert.equal(silentPreview.ok, true, silentPreview.content);
  assert.equal(silentJob!.kind, "clip");
  assert.equal(silentJob!.duration, 5);
  assert.deepEqual(silentJob!.beats.map((item) => item.seconds), [2, 2.5]);
  const withVoice = await prepareExplainer({ ...silentInput, voice: "Aria" }, { previewed: async () => [input.code], save: async () => "a".repeat(64) });
  assert.equal(withVoice, "voice: a silent clip has no narration.");
  const untimed = await runPreviewExplainer({ ...silentInput, beats: [{ say: "No time.", visual: "x" }] }, { preview: async () => assert.fail("must not render") });
  assert.match(untimed.content, /beats\.0\.seconds/);
  const tooLong = await runPreviewExplainer({ ...silentInput, beats: [{ say: "a", visual: "x", seconds: 20 }, { say: "b", visual: "y", seconds: 11 }] }, { preview: async () => assert.fail("must not render") });
  assert.match(tooLong.content, /at most 30 seconds/);
  const silentPrepared = await prepareExplainer(silentInput, { previewed: async () => [input.code], save: async () => "a".repeat(64) });
  assert.ok(typeof silentPrepared !== "string", String(silentPrepared));
  assert.equal(silentPrepared.model.id, "motion-clip");
  assert.equal(silentPrepared.spec.duration, 5);
  assert.ok(!("voice" in silentPrepared.spec), "a silent clip's spec has no voice");
  assert.deepEqual((silentPrepared.spec.scene as { template: string; beats: unknown[] }).beats, [{ say: "The mark lands.", seconds: 2 }, { say: "The name rises.", label: "OpenCMO", seconds: 2.5 }]);
  assert.equal((silentPrepared.spec.scene as { template: string }).template, "clip");
  const silentCard = explainerCard(silentPrepared, "clip");
  assert.match(silentCard.changes[0]!, /^Motion clip “.*” · 5s · 16:9 .*· No narration · 1 credit$/);
  assert.match(silentCard.changes[1]!, /^Beat 1 · 2s: “The mark lands\.”/);
  const narrated = await runPreviewExplainer({ ...input, beats: input.beats.slice(0, 2) }, { preview: async () => assert.fail("must not render") });
  assert.match(narrated.content, /3 to 16 beats/);

  // Motion styles: the list names each with what it suits; one style comes with its guide and example code.
  const styles = JSON.parse(runMotionTemplateTool("list_motion_styles", {}).content) as { styles: { id: string; bestFor: string[] }[] };
  assert.ok(styles.styles.some((item) => item.id === "kinetic-type") && styles.styles.every((item) => item.bestFor.length > 0));
  const kinetic = JSON.parse(runMotionTemplateTool("get_motion_style", { id: "kinetic-type" }).content) as { guide: string; code: string };
  assert.match(kinetic.guide, /## Palette/);
  assert.match(kinetic.code, /kit\.travel|kit\.snap/);
  assert.equal(runMotionTemplateTool("get_motion_style", { id: "nope" }).ok, false);

  // B5: motion templates. The list is short; an unknown id answers with the ids; a template comes with its code.
  const listed = runMotionTemplateTool("list_motion_templates", {});
  assert.deepEqual((JSON.parse(listed.content) as { templates: { id: string }[] }).templates.map((item) => item.id), ["analytics-glow", "logo-bloom", "mark-lockup", "phone-carousel", "product-tour", "type-snap"]);
  const nope = runMotionTemplateTool("get_motion_template", { id: "nope" });
  assert.equal(nope.ok, false);
  assert.match(nope.content, /Unknown template \\"nope\\": use one of analytics-glow, logo-bloom, mark-lockup, phone-carousel, product-tour, type-snap\./);
  const lockup = JSON.parse(runMotionTemplateTool("get_motion_template", { id: "mark-lockup" }).content) as { code: string; direction: string; format: string };
  assert.match(lockup.code, /const SLOTS = \{/);
  assert.equal(lockup.format, "16:9");
  assert.ok(lockup.direction.length >= 120);
  // Every template's beats and direction go to preview_explainer as they are, with the silent flag the tool returns.
  for (const { id } of (JSON.parse(listed.content) as { templates: { id: string }[] }).templates) {
    const template = JSON.parse(runMotionTemplateTool("get_motion_template", { id }).content) as { title: string; code: string; direction: string; beats: unknown[]; format: string; silent: boolean; how: string };
    assert.equal(template.silent, true, id);
    assert.match(template.how, /silent: true/, id);
    const parsed = previewExplainerInput.safeParse({ title: template.title, code: template.code, direction: template.direction, beats: template.beats, format: template.format, silent: template.silent });
    assert.ok(parsed.success, `${id}: ${parsed.error?.issues[0]?.path.join(".")} ${parsed.error?.issues[0]?.message}`);
  }

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
