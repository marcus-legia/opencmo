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
  EXPLAINER_FORMATS,
  EXPLAINER_MODEL,
  ExplainerBeatSchema,
  explainerSeconds,
  narrationOf,
  type ExplainerBeat,
  type ExplainerFormat,
  type Op,
} from "@opencmo/editor-core";
import { priceOf, type GenerationSpec } from "@opencmo/editor-core/generate";

import { ApiError } from "@/lib/api/errors";
import { normalizeSpec } from "@/lib/generate/create";
import { availableModels } from "@/lib/generate/models";

import type { PreparedGeneration } from "./generate-tool";
import type { Image } from "./providers/types";
import { sanitize, type ToolOutcome, type ToolSpec } from "./tools";

/** Same cap as `MAX_CODE_CHARS` in `packages/clip-motion/src/job.ts` and `scene_codes`. */
export const EXPLAINER_CODE_CHARS = 32_000;

const FORMATS = Object.keys(EXPLAINER_FORMATS) as [ExplainerFormat, ...ExplainerFormat[]];

const beat = z.object({
  say: ExplainerBeatSchema.shape.say.describe("The narration of this beat, 6-20 words. The voice reads every beat in order."),
  label: ExplainerBeatSchema.shape.label.describe("The main words on screen during this beat, at most 5 words."),
});

const sceneFields = {
  title: z.string().trim().min(1).max(60).describe('Short name of the explainer (price card, layer name), e.g. "How Shazam hears a song".'),
  beats: z.array(beat).min(3).max(16).describe("The script, one entry per beat of about 4 s, in order."),
  code: z.string().min(1).max(EXPLAINER_CODE_CHARS).describe('The body of (React, R, kit) => { …; return function Scene() { … } } with JSX, no imports (read_guide "explainer").'),
  format: z.enum(FORMATS).describe("The video's shape: clip_context.frame on a clip; on a blank New edit what the user asked for (9:16 by default)."),
};

export const previewExplainerInput = z.object(sceneFields);

export const addExplainerInput = z.object({
  ...sceneFields,
  code: sceneFields.code.describe("The scene code exactly as last previewed with preview_explainer in this request."),
  voice: z.string().min(1).max(100).describe("A premade narration voice from the list in this tool's description."),
  start: z.number().finite().min(0).optional().describe("Clip seconds where it starts. Default: the playhead, or 0 on a blank clip."),
});

/** What `previewMotion` takes: the `MotionJob` of `packages/clip-motion/src/job.ts`. */
export type MotionJob = {
  title: string;
  code: string;
  beats: ExplainerBeat[];
  format: ExplainerFormat;
  duration: number;
  seed: number;
  accent?: string;
};

/** What `previewMotion` returns (`apps/web/lib/motion/preview.ts`): `PreviewResult` plus base64 JPEGs. */
export type MotionPreview =
  | { ok: true; stills: { t: number; file: string }[]; issues: string[]; estimated: boolean; images?: string[] }
  | { ok: false; phase: "job" | "compile" | "guard" | "render"; message: string };

export type PreviewMotion = (job: MotionJob) => Promise<MotionPreview>;

const explainerModel = () => availableModels().find((model) => model.id === EXPLAINER_MODEL);

const issueOf = (error: z.ZodError) => {
  const issue = error.issues[0];
  return `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "Invalid input."}`;
};

/** The voices the model offers; the tool lists them so the model never guesses a name. */
const voicesOf = () => explainerModel()?.limits.voices ?? [];

/** Both tools exist only when the server has the explainer model (local CLI, Modal, or fake). */
export function explainerToolSpecs(): ToolSpec[] {
  if (!explainerModel()) return [];
  return [
    {
      name: "preview_explainer",
      description:
        'Render stills of an explainer you wrote (beat midpoints and the last frame) and look at them, with a layout report: text overlapping text, anything outside the safe area, text too small, a nearly empty frame. Errors come back with the phase (job/compile/guard/render) and the message. Fix and preview again, up to 3 rounds, until there are no errors and no issues; then add it with add_explainer. Free. read_guide "explainer" first.',
      schema: sanitize(z.toJSONSchema(previewExplainerInput, { io: "input" })).schema as Record<string, unknown>,
      strict: false,
    },
    {
      name: "add_explainer",
      description: `Render an animated explainer (15-90 s, narrated, one video layer) from code you previewed with preview_explainer in this request. It costs credits: the user sees the beats, the voice and the price and must approve. Voices: ${voicesOf().join(", ")}.`,
      schema: sanitize(z.toJSONSchema(addExplainerInput, { io: "input" })).schema as Record<string, unknown>,
      strict: false,
      approval: true,
    },
  ];
}

/** The job a preview renders: the duration is estimated from the narration (real timings come with the voice). */
export function previewJob(input: z.infer<typeof previewExplainerInput>, accent?: string): MotionJob {
  return {
    title: input.title,
    code: input.code,
    beats: input.beats,
    format: input.format,
    duration: explainerSeconds(input.beats),
    seed: 0,
    ...(accent ? { accent } : {}),
  };
}

export async function runPreviewExplainer(input: unknown, env: { preview: PreviewMotion; accent?: string }): Promise<ToolOutcome> {
  const parsed = previewExplainerInput.safeParse(input);
  if (!parsed.success) return { ok: false, content: JSON.stringify({ INVALID_INPUT: issueOf(parsed.error) }), summary: "Invalid explainer" };
  const job = previewJob(parsed.data, env.accent);
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
    }),
    summary: count ? `Previewed the explainer: ${count} layout ${count === 1 ? "issue" : "issues"}` : "Previewed the explainer",
    images,
  };
}

/** The code previewed in this turn, newest first (read under RLS from `agent_tool_calls`). */
export type PreviewedCodes = () => Promise<string[]>;

export type PreparedExplainer = PreparedGeneration & { explainer: { title: string; beats: ExplainerBeat[]; voice: string } };

/**
 * Checks the code was previewed, saves it (`save_scene_code`), builds and prices the spec. The op
 * carries the exact spec priced here: what the user approves is what renders.
 */
export async function prepareExplainer(
  input: unknown,
  env: { previewed: PreviewedCodes; save: (code: string) => Promise<string>; accent?: string },
): Promise<PreparedExplainer | string> {
  const parsed = addExplainerInput.safeParse(input);
  if (!parsed.success) return issueOf(parsed.error);
  const model = explainerModel();
  if (!model) return "Explainers are not available.";
  const request = parsed.data;
  const voices = model.limits.voices ?? [];
  if (!voices.includes(request.voice)) return `voice: choose one of ${voices.join(", ")}.`;
  // Same rule as the guide: only code the model has looked at goes out for credits.
  if (!(await env.previewed()).includes(request.code)) {
    return "Preview this exact code with preview_explainer first (in this request), fix what it reports, then add it.";
  }
  let hash: string;
  try {
    hash = await env.save(request.code);
  } catch (err) {
    return err instanceof ApiError ? err.message : "Could not save the explainer code.";
  }
  const duration = explainerSeconds(request.beats);
  const scene = {
    template: "explainer" as const,
    code_ref: hash,
    title: request.title,
    beats: request.beats.map((item) => ({ say: item.say, ...(item.label ? { label: item.label } : {}) })),
    ...(env.accent ? { accent: env.accent } : {}),
  };
  let spec: GenerationSpec;
  try {
    spec = normalizeSpec(model, {
      prompt: `Explainer: ${request.title}`.slice(0, model.limits.maxPromptChars),
      aspectRatio: request.format,
      duration,
      voice: request.voice,
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
  return { model, spec, op, credits: priceOf(model, spec), explainer: { title: request.title, beats: scene.beats, voice: request.voice } };
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

/** The price card: one line per beat (Beat / Voice / On screen), the voice and the credits. */
export function explainerCard(prepared: PreparedExplainer, clipId: string) {
  const credits = `${prepared.credits} ${prepared.credits === 1 ? "credit" : "credits"}`;
  const seconds = prepared.spec.duration ?? 0;
  return {
    clips: [{ id: clipId, label: "This clip" }],
    changes: [
      `Explainer “${prepared.explainer.title}” · ${seconds}s · ${prepared.spec.aspectRatio} · voice ${prepared.explainer.voice} · ${credits}`,
      ...prepared.explainer.beats.map((item, index) => `Beat ${index + 1} · Voice: “${item.say}”${item.label ? ` · On screen: ${item.label}` : ""}`),
    ],
    credits: prepared.credits,
  };
}

