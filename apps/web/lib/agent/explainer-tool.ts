/**
 * Explainer tools of the editor Assistant (`docs/explainer-build.md`, Track C), charged before running (D9):
 *
 * `plan_explainer` shows the storyboard (say / label / picture per beat), the direction and ONE price before any
 * code is written: the render, plus writing and checking the animation (billed as used, up to
 * `AGENT_3D_HOLD_CREDITS`). Approving holds the render price in one job (`credit_orders`).
 *
 * `preview_explainer` renders stills of the scene code the model wrote (Remotion, through `previewMotion`) and
 * returns them as images plus a layout report, so the model looks at its own work and fixes it. It runs only once
 * a plan was approved: no render happens before the user agreed to the price.
 *
 * `add_explainer` saves the previewed code (`scene_codes`, by hash), builds the `motion-explainer` spec, starts it
 * from the approved job (no second card) and op `add_explainer` places one video layer. The voice is generated
 * inside the render job.
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
import { MAX_PREVIEW_STILLS, MAX_SHEET_FRAMES } from "@opencmo/clip-motion/job";
import { MOTION_STYLES, motionStyle } from "@opencmo/clip-motion/styles";
import { MOTION_TEMPLATES, motionTemplate } from "@opencmo/clip-motion/templates";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";
import { normalizeSpec } from "@/lib/generate/create";
import { availableModels } from "@/lib/generate/models";

import { runGeneration, type LookupImage, type PreparedGeneration } from "./generate-tool";
import type { JobSource } from "./create-video";
import { AGENT_3D_HOLD_CREDITS } from "./limits";
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
    // 160 failed real storyboards by a few characters (2026-11-08) and cost a whole model step to redo.
    .max(240, "at most 240 characters: name the one thing drawn and how it moves")
    .describe('At most 240 characters. What is drawn in this beat and how it changes, drawn in the scene code, e.g. "a flat disc tilts 30° to show its edge; a dashed horizon line draws across it; a ship sinks hull-first below the curve".'),
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
  "Answer each line about the stills you just saw, in order (read the issues first: every check you declared with kit.audit and every jump, lurch or blur at rest is listed there with its time):",
  "1. Subject: does every still show what its beat says (\"shows X; the beat says Y\")?",
  "2. Drawing: is the subject drawn as itself (its silhouette, depth and its own motion in a Mark), not a stock icon in a ring or a medallion?",
  "3. Direction: is every move where your direction puts it at that time (position, size, order)? Name any number that is off.",
  "4. One visual centre per beat: is the eye drawn to one thing, or do several things compete, like slide cards?",
  "5. Text: is resting text crisp, big enough and fully inside the frame, never over another text or mark?",
  "6. Motion: does something change in every beat, and does each move ease in and settle (no jumps, no frozen beat)?",
  "7. Finish: margins even, colours from your direction's palette, type set with care (tracking, weight, line height), the last frame a clean end state?",
  "8. The bar: would this pass in a launch video by a top design team? Name what they would do differently here (depth, a bolder type scale, a better curve, more life in the rest) and do it.",
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
    sheet: z
      .object({ from: z.number().finite().min(0), to: z.number().finite().min(0), count: z.number().int().min(2).max(MAX_SHEET_FRAMES) })
      .refine((value) => value.to > value.from, "to must be after from")
      .optional()
      .describe(`One contact-sheet image of count frames (2-${MAX_SHEET_FRAMES}) spread from \`from\` to \`to\` seconds, in reading order: use it on your most important move to see its whole curve, not three moments.`),
    zoom: z
      .object({ t: z.number().finite().min(0), x: z.number().finite().min(0), y: z.number().finite().min(0), w: z.number().finite().min(16), h: z.number().finite().min(16) })
      .optional()
      .describe("A full-resolution crop of one frame (px of the composition): check that resting text and fine lines are crisp."),
    code: sceneFields.code.optional().describe('The body of (React, R, kit) => { …; return function Scene() { … } } with JSX, no imports (read_guide "explainer"). Leave it out when you send variants.'),
    variants: z
      .array(z.object({ label: z.string().trim().min(1).max(40).describe('The direction\'s name for the user, e.g. "Kinetic type".'), code: sceneFields.code }))
      .min(2)
      .max(3)
      .optional()
      .describe("Style directions to choose from before the whole video: 2-3 scene codes of the same hero shot, each rendered at times[0] (default: beat 1's middle), returned as ONE image side by side, left to right in this order. Counts as one preview."),
  })
  .superRefine(silentRules)
  .superRefine((value, ctx) => {
    if (value.code === undefined && !value.variants) ctx.addIssue({ code: "custom", path: ["code"], message: "send the scene code, or variants to compare directions." });
  });

export const addExplainerInput = z
  .object({
    ...sceneFields,
    code: sceneFields.code.describe("The scene code exactly as last previewed with preview_explainer in this request."),
    voice: z.string().min(1).max(100).optional().describe("A premade narration voice from the list in this tool's description. Leave it out for a silent clip."),
    start: z.number().finite().min(0).optional().describe("Clip seconds where it starts. Default: the playhead, or 0 on a blank clip."),
    place: z
      .enum(["full", "top", "bottom", "left", "right", "behind"])
      .optional()
      .describe("On a clip with a speaker, for the animation's time: top = the animation in the upper band and the speaker below (bottom = the other way round; the split is sized to the animation's shape, so on 9:16 use format 1:1 or 16:9); left/right = the animation in that column and the speaker in the other (16:9; format 1:1 fills the column best); behind = the animation fills the frame and the speaker sits in a corner over it, a YouTube facecam (16:9; keep the bottom-right corner of the scene empty). Default: full frame, or the visual area of a layout already there."),
  })
  .superRefine(silentRules);

/** What the user approves before any code: the storyboard, the direction, the look and the voice. */
export const planExplainerInput = z
  .object({
    title: sceneFields.title,
    beats: sceneFields.beats,
    silent: sceneFields.silent,
    direction,
    format: sceneFields.format,
    theme: sceneFields.theme,
    personality: sceneFields.personality,
    voice: z.string().min(1).max(100).optional().describe("A premade narration voice from the list in this tool's description. Leave it out for a silent clip."),
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
  /** Preview only: one contact sheet across a window. */
  sheet?: { from: number; to: number; count: number };
  /** Preview only: a full-resolution crop of one frame. */
  zoom?: { t: number; x: number; y: number; w: number; h: number };
  /** Preview only: 2-3 style directions, one hero still each, side by side. */
  variants?: { label: string; code: string }[];
  /** A silent motion clip: beats timed by their own seconds. */
  kind?: "clip";
  /** Images for kit.Image: signed URLs in a preview. */
  assets?: { name: string; src: string }[];
};

/** What `previewMotion` returns (`apps/web/lib/motion/preview.ts`): `PreviewResult` plus base64 JPEGs. */
export type MotionPreview =
  | { ok: true; stills: { t: number; file: string; kind?: "sheet" | "zoom" | "variants"; times?: number[]; columns?: number; labels?: string[] }[]; issues: string[]; estimated: boolean; images?: string[] }
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
export const MOTION_TEMPLATE_TOOLS = new Set(["list_motion_styles", "get_motion_style", "list_motion_templates", "get_motion_template"]);

export const getMotionTemplateInput = z.object({ id: z.string().min(1).max(60).describe("A template id from list_motion_templates.") });
export const getMotionStyleInput = z.object({ id: z.string().min(1).max(60).describe("A style id from list_motion_styles.") });

export const motionTemplateSpecs = (): ToolSpec[] => [
  {
    name: "list_motion_styles",
    description:
      "List the motion styles: named art directions (palette, background, type, motion vocabulary) each with a finished example shot. Pick the one that fits the topic before the storyboard, or derive your own from the user's brand. Free.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    strict: false,
  },
  {
    name: "get_motion_style",
    description:
      "Get one motion style: its guide (palette hex values, background recipe, fonts, motion with numbers, composition, do and don't) and the scene code of its example shot. Read the code to learn the techniques, then write your own scene in that direction. Free.",
    schema: sanitize(z.toJSONSchema(getMotionStyleInput, { io: "input" })).schema as Record<string, unknown>,
    strict: false,
  },
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
  if (name === "list_motion_styles") {
    const styles = MOTION_STYLES.map(({ id, title, line, bestFor, format, seconds }) => ({ id, title, line, bestFor, example: { format, seconds } }));
    return { ok: true, content: JSON.stringify({ styles, next: "get_motion_style { id } for its guide and example code." }), summary: `${styles.length} motion styles` };
  }
  if (name === "get_motion_style") {
    const parsed = getMotionStyleInput.safeParse(input);
    if (!parsed.success) return { ok: false, content: JSON.stringify({ INVALID_INPUT: issueOf(parsed.error) }), summary: "Invalid style" };
    const style = motionStyle(parsed.data.id);
    if (!style) return { ok: false, content: JSON.stringify({ error: `Unknown style "${parsed.data.id}": use one of ${MOTION_STYLES.map((item) => item.id).join(", ")}.` }), summary: "Unknown style" };
    return {
      ok: true,
      content: JSON.stringify({
        ...style,
        how: "Follow the guide's palette, background, fonts and motion numbers in YOUR scene; the example is a reference for techniques, not a template to fill. It previews as a silent clip with its beats if you want to see it first.",
      }),
      summary: `Style: ${style.title}`,
    };
  }
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
      name: "plan_explainer",
      description: `First step of every explainer or motion clip, before any code: show the user the storyboard (say / label / visual per beat), your motion direction, the look and the voice, with ONE price: the render, plus writing and checking the animation (billed as used, up to ${AGENT_3D_HOLD_CREDITS} credits). The user approves on a card; nothing is rendered or charged before that. Then write the code, preview_explainer it, and add_explainer it: no second card. If the user changes the storyboard after approving, call plan_explainer again. Voices: ${voicesOf().join(", ")}. read_guide "explainer" first.`,
      schema: sanitize(z.toJSONSchema(planExplainerInput, { io: "input" })).schema as Record<string, unknown>,
      strict: false,
      approval: true,
    },
    {
      name: "preview_explainer",
      description:
        `Render stills of an explainer you wrote and look at them. Only after the user approved plan_explainer in THIS turn: an approval from an earlier turn has ended, so call plan_explainer before writing any scene code, or the code is written for nothing. Code from the approved direction. Stills come at the times you pick (around every main move), or at beat midpoints and the last frame; a layout report comes with them: text overlapping text, anything outside the safe area, text too small, a nearly empty frame, a beat with no subject or no motion, a mark that jumps or zooms too fast in one frame, text still blurred at rest, and every kit.audit check of the scene that fails. Ask for a contact sheet (sheet) to see a whole move and a zoom to check crisp text. variants renders 2-3 style directions of the hero shot side by side in one image for the user to pick from. Errors come back with the phase (job/compile/guard/render) and the message. Then answer the review checklist that comes back, fix the one worst problem, and preview again, up to ${PREVIEW_ROUNDS} rounds, until a round finds nothing; then add it with add_explainer. read_guide "explainer" first.`,
      schema: sanitize(z.toJSONSchema(previewExplainerInput, { io: "input" })).schema as Record<string, unknown>,
      strict: false,
    },
    {
      name: "add_explainer",
      description: `Render the explainer (15-90 s, narrated) or, with silent: true, the silent motion clip (3-30 s) the user approved with plan_explainer, as one video layer, from code you previewed with preview_explainer. Fix what the last preview reported first: code whose last preview still lists issues is sent back once. It is paid from that approval: no second card. Send the same title, beats, format and voice as the approved plan; a longer video than planned is refused (plan_explainer again). Voices: ${voicesOf().join(", ")}.`,
      schema: sanitize(z.toJSONSchema(addExplainerInput, { io: "input" })).schema as Record<string, unknown>,
      strict: false,
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
    code: input.code ?? input.variants![0]!.code,
    beats,
    format: input.format,
    duration: input.silent ? clipSeconds(clipBeats(input.beats)) : explainerSeconds(beats),
    seed: 0,
    ...(accent ? { accent } : {}),
    ...lookOf(input),
    // Clamping and de-duplication happen in clip-motion (`previewFrames`), next to the timeline.
    ...(input.times?.length ? { stills: input.times } : {}),
    ...(input.sheet ? { sheet: input.sheet } : {}),
    ...(input.zoom ? { zoom: input.zoom } : {}),
    ...(input.variants ? { variants: input.variants.map(({ label, code }) => ({ label, code })) } : {}),
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
  if (parsed.data.variants) {
    // Style directions: the user picks, so no review rounds yet.
    const labels = parsed.data.variants.map((variant) => variant.label);
    return {
      ok: true,
      content: JSON.stringify({
        ok: true,
        stills: result.stills.map((still) => `style directions at ${still.t} s, left to right: ${(still.labels ?? labels).join(", ")}`),
        images: "one image: the directions side by side, left to right",
        issues: result.issues,
        next: `Show the user the image and ask which direction to take (ask_user with options ${labels.map((label) => `"${label}"`).join(", ")}). Then the storyboard and the whole scene in the chosen direction.`,
      }),
      summary: `Previewed ${labels.length} style directions`,
      images,
    };
  }
  return {
    ok: true,
    content: JSON.stringify({
      ok: true,
      duration: job.duration,
      stills: result.stills.map((still) => (still.kind === "variants" ? `style directions at ${still.t} s, left to right: ${still.labels?.join(", ")}` : still.kind === "sheet" ? `contact sheet of ${still.times?.join(", ")} s, ${still.columns} per row` : still.kind === "zoom" ? `zoom at ${still.t} s (full resolution)` : still.t)),
      images: "one image per entry of stills, in order",
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

/** Marks the one refusal of `add_explainer` over a preview's open issues: seen once in a turn, the next call goes through. */
export const ISSUES_GATE = "[preview issues]";

type ExplainerCallRow = { name: string; status: string; input: { code?: unknown } | null; content: unknown };

/**
 * The refusal `add_explainer` gets once a turn when the last preview of its code still listed layout issues
 * (2026-11-08: an explainer went out with "the frame is more than 85% empty at 20.0 s" unfixed); null to go on.
 * Only once: a report that is wrong about a scene must not trap the turn.
 */
export function previewIssuesGate(rows: readonly ExplainerCallRow[], code: string): string | null {
  if (rows.some((row) => row.name === "add_explainer" && row.status === "failed" && JSON.stringify(row.content ?? "").includes(ISSUES_GATE))) return null;
  const last = rows.find((row) => row.name === "preview_explainer" && row.status === "done" && String(row.input?.code ?? "") === code);
  if (!last) return null;
  let issues: unknown;
  try {
    const content = last.content as { text?: unknown } | null;
    issues = (JSON.parse(String(content?.text ?? "{}")) as { issues?: unknown }).issues;
  } catch {
    return null;
  }
  if (!Array.isArray(issues) || !issues.length) return null;
  const listed = issues.slice(0, 3).map(String).join("; ");
  return `${ISSUES_GATE} The last preview of this code still lists ${issues.length} issue${issues.length === 1 ? "" : "s"}: ${listed}. Fix them and preview again before adding it. If an issue is wrong about this scene, call add_explainer again with the same input and it goes through.`;
}

/** This turn's explainer calls, newest first, for `previewIssuesGate` (read under RLS). */
export async function explainerCalls(supabase: SupabaseClient, turnId: string): Promise<ExplainerCallRow[]> {
  const { data, error } = await supabase
    .from("agent_tool_calls")
    .select("name, status, input, content")
    .eq("turn_id", turnId)
    .in("name", ["preview_explainer", "add_explainer"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ExplainerCallRow[];
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
    ...(request.place === undefined ? {} : { place: request.place }),
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
      ...(prepared.explainer.images?.length ? [`Images from your media: ${prepared.explainer.images.join(", ")}`] : []),
      ...prepared.explainer.beats.map(
        (item, index) =>
          `Beat ${index + 1} · ${prepared.explainer.voice ? "Voice" : `${item.seconds ?? 0}s`}: “${item.say}”${item.label ? ` · On screen: ${item.label}` : ""} · Picture: ${item.visual}`,
      ),
    ],
    credits: prepared.credits,
  };
}


// ------------------------------------------------------------------ charge before running (D9)

export type PreparedExplainerPlan = {
  model: { id: string };
  /** The render: what the approval holds in one job. */
  credits: number;
  plan: z.infer<typeof planExplainerInput>;
  seconds: number;
};

/** The storyboard priced before any code: the render of exactly these beats and this voice. */
export function preparePlanExplainer(input: unknown): PreparedExplainerPlan | string {
  const parsed = planExplainerInput.safeParse(input);
  if (!parsed.success) return issueOf(parsed.error);
  const plan = parsed.data;
  const silent = plan.silent === true;
  const model = silent ? clipModel() : explainerModel();
  if (!model) return silent ? "Silent motion clips are not available." : "Explainers are not available.";
  const voices = model.limits.voices ?? [];
  if (!silent && (!plan.voice || !voices.includes(plan.voice))) return `voice: choose one of ${voices.join(", ")}.`;
  const seconds = silent ? clipSeconds(clipBeats(plan.beats)) : explainerSeconds(specBeats(plan.beats));
  // The price depends on the length and the narration, not on the code: the render add_explainer starts is this price.
  // The narration is priced from the scene's beats, as `ai_price` reads them: the same beats the render will carry.
  const beats = silent ? clipBeats(plan.beats) : specBeats(plan.beats);
  const credits = priceOf(model, { prompt: plan.title, aspectRatio: plan.format, duration: seconds, ...(silent ? {} : { voice: plan.voice }), seed: 0, scene: { beats } } as unknown as GenerationSpec);
  return { model: { id: model.id }, credits, plan, seconds };
}

/** The one card of an explainer: the storyboard and everything it will cost. */
/**
 * `allowance`: the Assistant's writing and checking, billed on its turn and capped at this by `agent_close_turn`.
 * Over MCP and in Studio the code is written elsewhere, so nothing is quoted for it.
 */
export function planExplainerCard(prepared: PreparedExplainerPlan, clipId: string, allowance = 0) {
  const { plan } = prepared;
  const total = prepared.credits + allowance;
  const look = [plan.theme, plan.personality].filter(Boolean).join(", ");
  return {
    clips: [{ id: clipId, label: "This clip" }],
    changes: [
      `${plan.silent ? "Motion clip" : "Explainer"} “${plan.title}” · ${prepared.seconds}s · ${plan.format}${look ? ` · ${look}` : ""} · ${plan.voice ? `voice ${plan.voice}` : "No narration"} · up to ${total} credits`,
      `Render · ${prepared.credits} credits${allowance ? ` · writing and checking the animation · billed as used, up to ${allowance} credits` : ""}`,
      ...plan.beats.map(
        (item, index) => `Beat ${index + 1} · ${plan.silent ? `${item.seconds ?? 0}s` : "Voice"}: “${item.say}”${item.label ? ` · On screen: ${item.label}` : ""} · Picture: ${item.visual}`,
      ),
      "One approval makes it: the stills are checked and the video renders without asking again.",
    ],
    credits: total,
  };
}

/** The clip and the conversation an explainer job was approved in: only they may draw from it. */
export type ExplainerScope = { clipId: string; source: JobSource };
const subjectOf = (clipId: string) => `clip:${clipId}`;

/** The open explainer job approved for this clip in this conversation (read under RLS), newest first. */
export async function openExplainerOrder(supabase: SupabaseClient, scope: ExplainerScope): Promise<{ id: string; estimate_credits: number } | null> {
  let query = supabase
    .from("credit_orders")
    .select("id, estimate_credits")
    .eq("kind", "explainer")
    .eq("status", "open")
    .eq("subject", subjectOf(scope.clipId))
    .eq("source_kind", scope.source.kind);
  query = scope.source.id ? query.eq("source_id", scope.source.id) : query.is("source_id", null);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; estimate_credits: number }>();
  if (error) throw error;
  return data ?? null;
}

export const PLAN_FIRST = "Show the storyboard and the price with plan_explainer first; the user approves it before anything is rendered.";

/** Approved: one job holds the render price; the model codes from the approved plan. */
export async function runPlanExplainer(
  env: { supabase: SupabaseClient } & ExplainerScope,
  prepared: PreparedExplainerPlan,
  requestId: string,
): Promise<ToolOutcome> {
  try {
    // A plan approved again here replaces the old one: its hold comes back first.
    const old = await openExplainerOrder(env.supabase, env);
    if (old) await rpcOrThrow(env.supabase, "credit_order_close", { p_order_id: old.id });
    const order = await rpcOrThrow<{ id: string }>(env.supabase, "credit_order_open", {
      p_kind: "explainer",
      p_estimate: Math.max(1, prepared.credits),
      p_source_kind: env.source.kind,
      p_source_id: env.source.id,
      p_request_id: requestId,
      p_subject: subjectOf(env.clipId),
    });
    return {
      ok: true,
      content: JSON.stringify({
        ok: true,
        approved: true,
        order_id: order.id,
        credits: prepared.credits,
        plan: prepared.plan,
        next: "The user approved this storyboard and its price. Write the scene code from it (same title, beats, format, voice and direction), preview_explainer it and fix what the review finds, then add_explainer: it renders without another card.",
      }),
      summary: `Explainer approved (${prepared.credits} credits held)`,
    };
  } catch (err) {
    const message = err instanceof ApiError && err.status < 500 ? err.message : "The explainer could not be approved.";
    if (!(err instanceof ApiError)) console.error("[agent] plan_explainer failed", err);
    return { ok: false, content: JSON.stringify({ error: message }), summary: message };
  }
}

/** add_explainer after the approval: the render starts from the job's hold, then the job closes (the rest comes back). */
export async function runAddExplainer(
  env: Parameters<typeof runGeneration>[0] & { source: JobSource },
  prepared: PreparedExplainer,
): Promise<ToolOutcome> {
  const order = await openExplainerOrder(env.supabase, { clipId: env.clipId, source: env.source });
  if (!order) return { ok: false, content: JSON.stringify({ error: PLAN_FIRST }), summary: "Plan the explainer first" };
  const { outcome } = await runGeneration({ ...env, orderId: order.id }, prepared);
  const overEstimate = !outcome.ok && /more credits than its estimate/.test(outcome.content);
  if (outcome.ok || overEstimate) {
    await rpcOrThrow(env.supabase, "credit_order_close", { p_order_id: order.id }).catch((err: unknown) => console.error("[agent] add_explainer: close failed", order.id, err));
  }
  if (overEstimate) {
    const message = "This explainer is longer than the one the user approved. Show it again with plan_explainer (the new price), then add it.";
    return { ok: false, content: JSON.stringify({ error: message }), summary: message };
  }
  return outcome;
}
