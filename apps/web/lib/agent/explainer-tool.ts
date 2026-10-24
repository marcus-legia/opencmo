/**
 * Explainer tools of the editor Assistant (`docs/explainer-build.md`, Track C).
 *
 * `preview_explainer` renders stills of the scene code the model wrote (Remotion, through
 * `previewMotion`) and returns them as images plus a layout report, so the model looks at its own
 * work and fixes it — the `preview_3d` loop, but rendered on the server. Free.
 *
 * `add_explainer` saves the previewed code (`scene_codes`, by hash), builds the `motion-explainer`
 * spec and shows a price card listing the beats; on Approve the generation starts and op
 * `add_explainer` places one video layer. The voice is generated inside the render job.
 */

import { randomInt } from "node:crypto";

import { z } from "zod";
import {
  CLIP_MAX_BEATS,
  CLIP_MAX_SECONDS,
  clipSeconds,
  EXPLAINER_FORMATS,
  EXPLAINER_MODEL,
  MOTION_CLIP_MODEL,
  EXPLAINER_PERSONALITIES,
  EXPLAINER_THEMES,
  ExplainerBeatSchema,
  explainerSeconds,
  MOTION_ASSET_NAME,
  MOTION_MAX_ASSETS,
  narrationOf,
  type ExplainerBeat,
  type ExplainerFormat,
  type ExplainerPersonality,
  type ExplainerTheme,
  type Op,
} from "@opencmo/editor-core";
import { priceOf, type GenerationSpec } from "@opencmo/editor-core/generate";
import { MAX_PREVIEW_STILLS } from "@opencmo/clip-motion/job";
import { MOTION_TEMPLATES, motionTemplate } from "@opencmo/clip-motion/templates";

import { ApiError } from "@/lib/api/errors";
import { normalizeSpec } from "@/lib/generate/create";
import { availableModels } from "@/lib/generate/models";

import type { LookupImage, PreparedGeneration } from "./generate-tool";
import type { Image } from "./providers/types";
import { sanitize, type ToolOutcome, type ToolSpec } from "./tools";

/** Same cap as `MAX_CODE_CHARS` in `packages/clip-motion/src/job.ts` and `scene_codes`. */
export const EXPLAINER_CODE_CHARS = 32_000;

const FORMATS = Object.keys(EXPLAINER_FORMATS) as [ExplainerFormat, ...ExplainerFormat[]];

const beat = z.object({
  say: ExplainerBeatSchema.shape.say.describe("The narration of this beat, 6-20 words. The voice reads every beat in order."),
  label: ExplainerBeatSchema.shape.label.describe("The main words on screen during this beat, at most 5 words."),
  visual: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe('What is drawn in this beat and how it changes, drawn in the scene code, e.g. "a flat disc tilts 30° to show its edge; a dashed horizon line draws across it; a ship sinks hull-first below the curve".'),
  seconds: z.number().min(0.5).max(30).optional().describe("Silent clips only: how long this beat lasts, 0.5-30 s. A narrated explainer is timed by its voice."),
});

/** A storyboard beat: the spec's `{ say, label? }` plus the picture, which stays out of the spec. */
export type StoryboardBeat = ExplainerBeat & { visual: string; seconds?: number };

/** Previews per explainer: the render → look → fix loop that made the Opus remakes good took about 5. */
export const PREVIEW_ROUNDS = 6;

/**
 * What the motion direction must say. Code written from a spec with numbers lands where it was planned; code
 * written from a vague brief leaves leftovers (docs/research/editor/2026-10-22-motion-quality-opus-claude-design.md).
 */
export const DIRECTION_HELP =
  "The motion spec you code from, with numbers, written before the code. Per beat: the one visual centre; every move as what, from → to (px of the frame or % of its width/height), start and end in seconds, and the curve (ease-out for entrances, ease-in-out for moves, a spring for pops); the reveal order; what stays alive between moves. No slide layouts, no rows of parallel cards. End with the bar: resting text crisp and readable, nothing clipped or overlapping, nothing jumping. 120-3000 characters.";

/** Returned with every clean preview: the model answers it line by line before the next round or add_explainer. */
export const REVIEW_CHECKLIST = [
  "Answer each line about the stills you just saw, in order:",
  "1. Subject: does every still show what its beat says (\"shows X; the beat says Y\")?",
  "2. Drawing: is the subject drawn as itself (its silhouette, depth and its own motion in a Mark), not a stock icon in a ring or a medallion?",
  "3. Direction: is every move where your direction puts it at that time (position, size, order)? Name any number that is off.",
  "4. One visual centre per beat: is the eye drawn to one thing, or do several things compete, like slide cards?",
  "5. Text: is resting text crisp, big enough and fully inside the frame, never over another text or mark?",
  "6. Motion: does something change in every beat, and does each move ease in and settle (no jumps, no frozen beat)?",
  "7. Finish: margins even, colours from the palette, the last frame a clean end state?",
  "Name the one worst problem you see, fix only that, and preview again; stop when a round finds nothing.",
].join("\n");

const direction = z
  .string({
    error: (issue) =>
      issue.input === undefined
        ? `missing. Before the code, write the motion direction: ${DIRECTION_HELP}`
        : "the direction is text: the motion spec with numbers.",
  })
  .trim()
  .min(120, "too short: give every beat its moves with positions, seconds and curves (at least 120 characters).")
  .max(3000, "too long: at most 3000 characters.")
  .describe(DIRECTION_HELP);

const assetsField = z
  .array(
    z.object({
      name: z.string().regex(MOTION_ASSET_NAME, "lowercase letters, digits and dashes, starting with a letter (at most 32)").describe('The name scene code uses: <kit.Image name="screen" …/>.'),
      image: z.string().min(1).max(500).describe("Library path of an image saved to the cloud (list_library: an upload, a finished AI image, or a frame from save_frame)."),
    }),
  )
  .max(MOTION_MAX_ASSETS)
  .refine((list) => new Set(list.map((item) => item.name)).size === list.length, "give each image a different name")
  .optional()
  .describe(`The user's own images the scene shows with kit.Image (product screenshots, a logo), at most ${MOTION_MAX_ASSETS}. Prefer real screens over drawn mock-ups.`);

/** Signed preview URLs for `{name, ref}`, or a sentence for the model (`apps/web/lib/motion/assets.ts`). */
export type SignAssets = (refs: { name: string; ref: string }[]) => Promise<{ name: string; src: string }[] | string>;

/** Each `{name, image}` → `{name, ref}`, or the message naming the first image that is not usable. */
async function assetRefs(assets: { name: string; image: string }[] | undefined, lookupImage: LookupImage | undefined): Promise<{ name: string; ref: string }[] | string> {
  if (!assets?.length) return [];
  const found = lookupImage ? await lookupImage(assets.map((asset) => asset.image)) : assets.map(() => null);
  const refs: { name: string; ref: string }[] = [];
  for (const [index, asset] of assets.entries()) {
    const ref = found[index];
    if (!ref) return `assets.${index}.image: "${asset.image}" is not an image saved to the cloud yet. Use an uploaded image, a finished AI image or save_frame, and wait until it is ready.`;
    refs.push({ name: asset.name, ref });
  }
  return refs;
}

const sceneFields = {
  title: z.string().trim().min(1).max(60).describe('Short name of the explainer (price card, layer name), e.g. "How Shazam hears a song".'),
  beats: z.array(beat).min(1).max(16).describe("The script, one entry per beat of about 4 s, in order: 3-16 beats narrated, 1-8 timed beats for a silent clip."),
  silent: z
    .boolean()
    .optional()
    .describe("true: a silent motion clip of 3-30 s (an intro, a logo reveal, a product moment): no voice, every beat gives its seconds, `say` is the storyboard line. Default false: a narrated explainer."),
  // Before `code` on purpose: models fill fields in order, so the spec is written before the code.
  direction,
  code: z.string().min(1).max(EXPLAINER_CODE_CHARS).describe('The body of (React, R, kit) => { …; return function Scene() { … } } with JSX, no imports (read_guide "explainer").'),
  format: z.enum(FORMATS).describe("The video's shape: clip_context.frame on a clip; on a blank New edit what the user asked for (9:16 by default)."),
  theme: z.enum(EXPLAINER_THEMES).optional().describe("blueprint (navy, glowing: tech, data, software, money) or paper (light, flat colours: science, health, people, how-to). Default blueprint."),
  personality: z
    .enum(EXPLAINER_PERSONALITIES)
    .optional()
    .describe("The motion of the whole video: premium (calm, smooth), corporate (crisp, clear), playful (bouncy), energetic (fast, punchy). Default premium."),
  assets: assetsField,
};

/** The rules that depend on `silent`, in one place for both tools. */
function silentRules(value: { silent?: boolean; beats: { seconds?: number }[]; voice?: string }, ctx: z.RefinementCtx) {
  if (!value.silent) {
    if (value.beats.length < 3) ctx.addIssue({ code: "custom", path: ["beats"], message: "a narrated explainer has 3 to 16 beats." });
    return;
  }
  if (value.voice !== undefined) ctx.addIssue({ code: "custom", path: ["voice"], message: "a silent clip has no narration." });
  if (value.beats.length > CLIP_MAX_BEATS) ctx.addIssue({ code: "custom", path: ["beats"], message: `a silent clip has 1 to ${CLIP_MAX_BEATS} beats.` });
  let total = 0;
  value.beats.forEach((item, i) => {
    if (item.seconds === undefined) ctx.addIssue({ code: "custom", path: ["beats", i, "seconds"], message: "every beat of a silent clip says how many seconds it lasts (0.5-30)." });
    else total += item.seconds;
  });
  if (total > CLIP_MAX_SECONDS + 1e-9) ctx.addIssue({ code: "custom", path: ["beats"], message: `a silent clip lasts at most ${CLIP_MAX_SECONDS} seconds; its beats add up to ${Math.round(total * 10) / 10}.` });
}

export const previewExplainerInput = z
  .object({
    ...sceneFields,
    times: z
      .array(z.number().finite().min(0))
      .max(MAX_PREVIEW_STILLS)
      .optional()
      .describe(`Seconds to render stills at (at most ${MAX_PREVIEW_STILLS}): pick them around every main move of your direction, e.g. its start, middle and landing. Default: beat midpoints and the last frame.`),
  })
  .superRefine(silentRules);

export const addExplainerInput = z
  .object({
    ...sceneFields,
    code: sceneFields.code.describe("The scene code exactly as last previewed with preview_explainer in this request."),
    voice: z.string().min(1).max(100).optional().describe("A premade narration voice from the list in this tool's description. Leave it out for a silent clip."),
    start: z.number().finite().min(0).optional().describe("Clip seconds where it starts. Default: the playhead, or 0 on a blank clip."),
  })
  .superRefine(silentRules);

/** What `previewMotion` takes: the `MotionJob` of `packages/clip-motion/src/job.ts`. */
export type MotionJob = {
  title: string;
  code: string;
  beats: (ExplainerBeat & { seconds?: number })[];
  format: ExplainerFormat;
  duration: number;
  seed: number;
  accent?: string;
  theme?: ExplainerTheme;
  personality?: ExplainerPersonality;
  /** Preview only: seconds to render stills at. */
  stills?: number[];
  /** A silent motion clip: beats timed by their own seconds. */
  kind?: "clip";
  /** Images for kit.Image: signed URLs in a preview. */
  assets?: { name: string; src: string }[];
};

/** What `previewMotion` returns (`apps/web/lib/motion/preview.ts`): `PreviewResult` plus base64 JPEGs. */
export type MotionPreview =
  | { ok: true; stills: { t: number; file: string }[]; issues: string[]; estimated: boolean; images?: string[] }
  | { ok: false; phase: "job" | "compile" | "guard" | "render"; message: string };

export type PreviewMotion = (job: MotionJob) => Promise<MotionPreview>;

const explainerModel = () => availableModels().find((model) => model.id === EXPLAINER_MODEL);
const clipModel = () => availableModels().find((model) => model.id === MOTION_CLIP_MODEL);

const issueOf = (error: z.ZodError) => {
  const issue = error.issues[0];
  return `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "Invalid input."}`;
};

/**
 * Motion templates (ported from Opus's MIT remakes, `packages/clip-motion/templates`): finished silent clips a model
 * starts from instead of a blank scene. Free, no clip needed; the MCP server registers the same two tools.
 */
export const MOTION_TEMPLATE_TOOLS = new Set(["list_motion_templates", "get_motion_template"]);

export const getMotionTemplateInput = z.object({ id: z.string().min(1).max(60).describe("A template id from list_motion_templates.") });

export const motionTemplateSpecs = (): ToolSpec[] => [
  {
    name: "list_motion_templates",
    description:
      "List the motion templates: finished silent clips (a brand reveal, a phone carousel of app screens, an analytics card) with their format, length and slots. Start from one when it fits the moment instead of writing a scene from scratch. Free.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    strict: false,
  },
  {
    name: "get_motion_template",
    description:
      "Get one motion template: its scene code (edit only the SLOTS at the top: texts, colours, and image names you pass as assets), its direction (the motion spec, already valid for preview_explainer), its beats with seconds and its format. Keep the motion as it is; preview it, then add it. Free.",
    schema: sanitize(z.toJSONSchema(getMotionTemplateInput, { io: "input" })).schema as Record<string, unknown>,
    strict: false,
  },
];

export function runMotionTemplateTool(name: string, input: unknown): ToolOutcome {
  if (name === "list_motion_templates") {
    const templates = MOTION_TEMPLATES.map(({ id, title, description, kind, format, seconds, slots }) => ({ id, title, description, kind, format, seconds, slots }));
    return { ok: true, content: JSON.stringify({ templates, next: "get_motion_template { id } for its code, direction and beats." }), summary: `${templates.length} motion templates` };
  }
  const parsed = getMotionTemplateInput.safeParse(input);
  if (!parsed.success) return { ok: false, content: JSON.stringify({ INVALID_INPUT: issueOf(parsed.error) }), summary: "Invalid template" };
  const template = motionTemplate(parsed.data.id);
  if (!template) {
    const ids = MOTION_TEMPLATES.map((item) => item.id).join(", ");
    return { ok: false, content: JSON.stringify({ error: `Unknown template "${parsed.data.id}": use one of ${ids}.` }), summary: "Unknown template" };
  }
  return {
    ok: true,
    content: JSON.stringify({
      ...template,
      silent: template.kind === "clip",
      how: `Copy code and change only the values in SLOTS (an image slot takes an asset name you also pass in assets, from the user's library). Send direction and beats as they are, adjusting only the words, with format "${template.format}"${template.kind === "clip" ? " and silent: true (a silent clip, timed by each beat's seconds)" : ""}. Preview it, then add it.`,
    }),
    summary: `Template: ${template.title}`,
  };
}

/** The voices the model offers; the tool lists them so the model never guesses a name. */
const voicesOf = () => explainerModel()?.limits.voices ?? [];

/** Both tools exist only when the server has the explainer model (local CLI, Modal, or fake). */
export function explainerToolSpecs(): ToolSpec[] {
  if (!explainerModel() && !clipModel()) return [];
  return [
    ...motionTemplateSpecs(),
    {
      name: "preview_explainer",
      description:
        `Render stills of an explainer you wrote and look at them. Write the direction (the motion spec with numbers) before the code. Stills come at the times you pick (around every main move), or at beat midpoints and the last frame; a layout report comes with them: text overlapping text, anything outside the safe area, text too small, a nearly empty frame, a beat with no subject or no motion, a mark that jumps in one frame. Errors come back with the phase (job/compile/guard/render) and the message. Then answer the review checklist that comes back, fix the one worst problem, and preview again, up to ${PREVIEW_ROUNDS} rounds, until a round finds nothing; then add it with add_explainer. Free. read_guide "explainer" first.`,
      schema: sanitize(z.toJSONSchema(previewExplainerInput, { io: "input" })).schema as Record<string, unknown>,
      strict: false,
    },
    {
      name: "add_explainer",
      description: `Render an animated explainer (15-90 s, narrated) or, with silent: true, a silent motion clip (3-30 s: an intro, a logo reveal, a product moment), as one video layer, from code you previewed with preview_explainer in this request. It costs credits: the user sees the beats, the voice and the price and must approve. Voices: ${voicesOf().join(", ")}.`,
      schema: sanitize(z.toJSONSchema(addExplainerInput, { io: "input" })).schema as Record<string, unknown>,
      strict: false,
      approval: true,
    },
  ];
}

/** The spec's beats: `visual` is for the user and the model, not the render (and the scene must stay ≤ 4000 bytes). */
const specBeats = (beats: readonly StoryboardBeat[]): ExplainerBeat[] => beats.map((item) => ({ say: item.say, ...(item.label ? { label: item.label } : {}) }));
/** A silent clip's beats keep their seconds: they time the render. */
const clipBeats = (beats: readonly StoryboardBeat[]) => beats.map((item) => ({ ...specBeats([item])[0]!, seconds: item.seconds ?? 0 }));

/** `theme` / `personality` when the model chose them: absent means the v1 look and motion. */
const lookOf = (input: { theme?: ExplainerTheme; personality?: ExplainerPersonality }) => ({
  ...(input.theme ? { theme: input.theme } : {}),
  ...(input.personality ? { personality: input.personality } : {}),
});

/** The job a preview renders: the duration is estimated from the narration (real timings come with the voice). */
export function previewJob(input: z.infer<typeof previewExplainerInput>, accent?: string): MotionJob {
  const beats = input.silent ? clipBeats(input.beats) : specBeats(input.beats);
  return {
    ...(input.silent ? { kind: "clip" as const } : {}),
    title: input.title,
    code: input.code,
    beats,
    format: input.format,
    duration: input.silent ? clipSeconds(clipBeats(input.beats)) : explainerSeconds(beats),
    seed: 0,
    ...(accent ? { accent } : {}),
    ...lookOf(input),
    // Clamping and de-duplication happen in clip-motion (`previewFrames`), next to the timeline.
    ...(input.times?.length ? { stills: input.times } : {}),
  };
}

/** The subject check the result asks for (guide step 4): the stills against the storyboard. */
export const SUBJECT_CHECK =
  'Before anything else, write one line per still: "shows X; the beat says Y" (Y = the things that beat\'s say names). Fix every beat where X is not Y, then preview again.';

export async function runPreviewExplainer(
  input: unknown,
  env: { preview: PreviewMotion; accent?: string; lookupImage?: LookupImage; signAssets?: SignAssets },
): Promise<ToolOutcome> {
  const parsed = previewExplainerInput.safeParse(input);
  if (!parsed.success) return { ok: false, content: JSON.stringify({ INVALID_INPUT: issueOf(parsed.error) }), summary: "Invalid explainer" };
  const job = previewJob(parsed.data, env.accent);
  if (parsed.data.assets?.length) {
    // Before any render: a path that is not the user's saved image is the model's to fix.
    const refs = await assetRefs(parsed.data.assets, env.lookupImage);
    const signed = typeof refs === "string" ? refs : env.signAssets ? await env.signAssets(refs) : "Images are not available for previews here.";
    if (typeof signed === "string") return { ok: false, content: JSON.stringify({ INVALID_INPUT: signed }), summary: "Invalid explainer" };
    job.assets = signed;
  }
  let result: MotionPreview;
  try {
    result = await env.preview(job);
  } catch (err) {
    const message = err instanceof ApiError || err instanceof Error ? err.message : "The preview could not be rendered.";
    console.error("[agent] preview_explainer failed", err);
    return { ok: false, content: JSON.stringify({ error: message }), summary: "Explainer preview failed" };
  }
  if (!result.ok) {
    // The scene code failed: the phase and message are what the model fixes.
    return { ok: false, content: JSON.stringify({ error: result.message, phase: result.phase }), summary: "Explainer preview failed" };
  }
  const images: Image[] = (result.images ?? []).map((data) => ({ data, mimeType: "image/jpeg" }));
  if (!images.length) return { ok: false, content: JSON.stringify({ error: "No stills came back." }), summary: "Explainer preview failed" };
  const count = result.issues.length;
  return {
    ok: true,
    content: JSON.stringify({
      ok: true,
      duration: job.duration,
      stills: result.stills.map((still) => still.t),
      images: "one image per still, in order",
      issues: result.issues,
      ...(result.estimated ? { timing: "estimated from the script; the real voice sets the final timing" } : {}),
      storyboard: parsed.data.beats.map((item, index) => `beat ${index + 1}: ${item.visual}`),
      check: SUBJECT_CHECK,
      review: REVIEW_CHECKLIST,
      rounds: `Up to ${PREVIEW_ROUNDS} previews: stop early when a round finds nothing to fix.`,
    }),
    summary: count ? `Previewed the explainer: ${count} layout ${count === 1 ? "issue" : "issues"}` : "Previewed the explainer",
    images,
  };
}

/** The code previewed in this turn, newest first (read under RLS from `agent_tool_calls`). */
export type PreviewedCodes = () => Promise<string[]>;

export type PreparedExplainer = PreparedGeneration & {
  /** `voice` absent: a silent motion clip. */
  explainer: { title: string; beats: StoryboardBeat[]; voice?: string; theme?: ExplainerTheme; personality?: ExplainerPersonality; images?: string[] };
};

/**
 * Checks the code was previewed, saves it (`save_scene_code`), builds and prices the spec. The op
 * carries the exact spec priced here: what the user approves is what renders.
 */
export async function prepareExplainer(
  input: unknown,
  env: { previewed: PreviewedCodes; save: (code: string) => Promise<string>; accent?: string; lookupImage?: LookupImage },
): Promise<PreparedExplainer | string> {
  const parsed = addExplainerInput.safeParse(input);
  if (!parsed.success) return issueOf(parsed.error);
  const request = parsed.data;
  const silent = request.silent === true;
  const model = silent ? clipModel() : explainerModel();
  if (!model) return silent ? "Silent motion clips are not available." : "Explainers are not available.";
  const voices = model.limits.voices ?? [];
  if (!silent && (!request.voice || !voices.includes(request.voice))) return `voice: choose one of ${voices.join(", ")}.`;
  // Same rule as the guide: only code the model has looked at goes out for credits.
  if (!(await env.previewed()).includes(request.code)) {
    return "Preview this exact code with preview_explainer first (in this request), fix what it reports, then add it.";
  }
  const refs = await assetRefs(request.assets, env.lookupImage);
  if (typeof refs === "string") return refs;
  let hash: string;
  try {
    hash = await env.save(request.code);
  } catch (err) {
    return err instanceof ApiError ? err.message : "Could not save the explainer code.";
  }
  const beats = silent ? clipBeats(request.beats) : specBeats(request.beats);
  const duration = silent ? clipSeconds(clipBeats(request.beats)) : explainerSeconds(beats);
  const scene = {
    template: silent ? ("clip" as const) : ("explainer" as const),
    code_ref: hash,
    title: request.title,
    beats,
    ...(env.accent ? { accent: env.accent } : {}),
    ...lookOf(request),
    // Library object names only: SQL and the worker check the owner, the worker inlines the pixels.
    ...(refs.length ? { assets: refs } : {}),
  };
  let spec: GenerationSpec;
  try {
    spec = normalizeSpec(model, {
      prompt: `${silent ? "Motion clip" : "Explainer"}: ${request.title}`.slice(0, model.limits.maxPromptChars),
      aspectRatio: request.format,
      duration,
      ...(silent ? {} : { voice: request.voice }),
      seed: randomInt(0, 2_147_483_647),
      scene,
    });
  } catch (err) {
    return err instanceof ApiError ? err.message : "Invalid input.";
  }
  const op = {
    op: "add_explainer",
    title: request.title,
    format: request.format,
    duration,
    ...(request.start === undefined ? {} : { start: request.start }),
    spec,
  } as unknown as Op;
  return {
    model,
    spec,
    op,
    credits: priceOf(model, spec),
    explainer: { title: request.title, beats: request.beats, ...(silent ? {} : { voice: request.voice }), ...lookOf(request), ...(refs.length ? { images: request.assets!.map((asset) => asset.image) } : {}) },
  };
}

/** Every string the render can show or say: the code's string literals (labels live in code) and the narration. */
export function explainerText(input: { title: string; beats: ExplainerBeat[]; code: string }): string {
  return [input.title, narrationOf(input.beats), ...input.beats.map((item) => item.label ?? ""), codeLiterals(input.code)].filter(Boolean).join("\n");
}

/** String literals and JSX text of the scene code, as the user would see them on screen. */
function codeLiterals(code: string): string {
  const literals = (code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []).map((literal) => literal.slice(1, -1));
  const jsxText = (code.match(/>([^<>{}]+)</g) ?? []).map((text) => text.slice(1, -1).trim());
  return [...literals, ...jsxText].filter((text) => /\p{L}{2}/u.test(text)).join("\n").slice(0, 8000);
}

/** The price card: one line per beat (Voice / On screen / Picture), the look, the voice and the credits. */
export function explainerCard(prepared: PreparedExplainer, clipId: string) {
  const credits = `${prepared.credits} ${prepared.credits === 1 ? "credit" : "credits"}`;
  const seconds = prepared.spec.duration ?? 0;
  const look = [prepared.explainer.theme, prepared.explainer.personality].filter(Boolean).join(", ");
  return {
    clips: [{ id: clipId, label: "This clip" }],
    changes: [
      `${prepared.explainer.voice ? "Explainer" : "Motion clip"} “${prepared.explainer.title}” · ${seconds}s · ${prepared.spec.aspectRatio}${look ? ` · ${look}` : ""} · ${prepared.explainer.voice ? `voice ${prepared.explainer.voice}` : "No narration"} · ${credits}`,
      ...(prepared.explainer.images?.length ? [`Images from your library: ${prepared.explainer.images.join(", ")}`] : []),
      ...prepared.explainer.beats.map(
        (item, index) =>
          `Beat ${index + 1} · ${prepared.explainer.voice ? "Voice" : `${item.seconds ?? 0}s`}: “${item.say}”${item.label ? ` · On screen: ${item.label}` : ""} · Picture: ${item.visual}`,
      ),
    ],
    credits: prepared.credits,
  };
}

