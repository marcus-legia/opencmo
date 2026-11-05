/**
 * A long take after it is placed (/video, `create_video`): `redo_keyframe` swaps one keyframe of the scene
 * and makes again only the shots that start or end on it, at its own price.
 */

import { randomInt, randomUUID } from "node:crypto";

import { z } from "zod";

import { keyframesOf, keyframeSource, byId, RedoKeyframeInputSchema, type KeyframeSource } from "@opencmo/editor-core";
import { priceOf, type AiModel, type GenerationSpec } from "@opencmo/editor-core/generate";
import type { ClipDocument } from "@opencmo/clip-doc";

import { ApiError } from "@/lib/api/errors";
import type { SupabaseClient } from "@/lib/api/handler";
import { createGeneration, normalizeSpec } from "@/lib/generate/create";
import { availableModel, availableModels, specHash } from "@/lib/generate/models";

import { credits, GENERATION_ACTIVE_LIMIT, libraryName } from "./create-video";
import { runGeneration } from "./generate-tool";
import { sanitize, type ToolOutcome, type ToolSpec } from "./tools";

const firstIssue = (error: z.ZodError) => `${error.issues[0]?.path.join(".") ?? ""}: ${error.issues[0]?.message ?? "Invalid input."}`;

/** The spec a keyframe was made with, read back from its declaration. */
const keyframeSpec = (source: KeyframeSource): GenerationSpec => ({
  prompt: source.prompt,
  aspectRatio: source.aspectRatio,
  ...(source.resolution ? { resolution: source.resolution } : {}),
  seed: source.seed,
});

type RedoEnv = { supabase: SupabaseClient; jobId: string; clipId: string };

/** Lists a new keyframe in the library as a pending record the editor finishes (`saveKeyframes`). */
export type ListKeyframe = (entry: { model: AiModel; spec: GenerationSpec; folder: string; name: string }, generationId: string) => Promise<void>;

// ------------------------------------------------------------------ redo_keyframe

export function redoKeyframeToolSpec(): ToolSpec | null {
  if (!availableModels().some((model) => model.kind === "video" && model.limits.firstFrame)) return null;
  return {
    name: "redo_keyframe",
    description:
      "Redo one keyframe of a long-take scene already on the timeline (the sequence create_video placed): one new image, then only the shots that start or end on it (at most two) are made again; every other shot stays. Use it when the user wants one moment of the video changed. scene_id = the sequence's id; index = the keyframe's position, 0 for the first. keyframe = an optional new description of that frame (subject, place, light, framing; never text). The user approves the price; the old keyframe and shots stay in the library, and Undo brings them back.",
    schema: sanitize(z.toJSONSchema(RedoKeyframeInputSchema, { io: "input" })).schema as Record<string, unknown>,
    strict: true,
    approval: true,
  };
}

/** What `redo_keyframe` approves: the new keyframe, the shots that change, and the op that re-declares them. */
export type PreparedRedo = {
  op: { op: "redo_keyframe"; sequence_id: string; index: number; keyframe: KeyframeSource };
  image: { model: AiModel; spec: GenerationSpec };
  /** `start` / `end`: the shot starts / ends on the keyframe being redone. */
  shots: { elementId: string; label: string; model: AiModel; declaration: Record<string, unknown>; start: boolean; end: boolean }[];
  credits: number;
  lines: string[];
  /** Where the new keyframe is listed in the library, next to the scene's first keyframes. */
  library: { folder: string; name: string };
};

/** A keyframe prompt opens with its description (`composePrompt`); a new description keeps the look the rest of it sets. */
export function redescribe(prompt: string, description: string): string {
  // The first sentence ends at a period followed by a space and a capital letter, so "9 a.m." or
  // "3.5-inch" inside the old description does not leave half of it in the new prompt.
  const end = /\.\s+(?=[A-Z])/.exec(prompt);
  const rest = end ? prompt.slice(end.index + end[0].length) : "";
  const opening = description.trim().replace(/[.\s]+$/, "");
  return `${opening.charAt(0).toUpperCase()}${opening.slice(1)}.${rest ? ` ${rest}` : ""}`;
}

const at = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function prepareRedoKeyframe(input: unknown, document: ClipDocument): PreparedRedo | string {
  const parsed = RedoKeyframeInputSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const { scene_id: sceneId, index } = parsed.data;
  const keyframes = keyframesOf(document, sceneId);
  if (!keyframes) return "That is not a long-take scene. Use the id of the sequence create_video placed.";
  const target = keyframes[index];
  if (!target) return `The scene has ${keyframes.length} keyframes (0 to ${keyframes.length - 1}); there is no keyframe ${index}.`;
  const imageModel = availableModel(target.source.model);
  if (!imageModel) return "That keyframe's image model is not available any more.";
  const keyframe: KeyframeSource = {
    ...target.source,
    prompt: parsed.data.keyframe ? redescribe(target.source.prompt, parsed.data.keyframe) : target.source.prompt,
    seed: randomInt(0, 2_147_483_647),
  };
  let image: GenerationSpec;
  try {
    image = normalizeSpec(imageModel, keyframeSpec(keyframe));
  } catch (err) {
    return err instanceof ApiError ? err.message : "Invalid keyframe.";
  }
  const shots: PreparedRedo["shots"] = [];
  let shotCredits = 0;
  for (const use of target.shots) {
    const found = findShot(document, use.id);
    const model = found ? availableModel(String(found.declaration.model)) : undefined;
    if (!found || !model) return "A shot on that keyframe uses a video model that is not available any more.";
    shots.push({ elementId: use.id, label: `${at(found.start)}–${at(found.end)}`, model, declaration: found.declaration, start: use.start, end: use.end });
    shotCredits += priceOf(model, pricedSpec(found.declaration));
  }
  const total = priceOf(imageModel, image) + shotCredits;
  const title = libraryName(String(byId(document, sceneId)?.entity.name ?? "Video"));
  return {
    library: { folder: `Generated/${title}/keyframes`, name: `${String(index + 1).padStart(2, "0")} ${libraryName(parsed.data.keyframe ?? "Keyframe")} (redo)` },
    op: { op: "redo_keyframe", sequence_id: sceneId, index, keyframe },
    image: { model: imageModel, spec: image },
    shots,
    credits: total,
    lines: [
      `Redo keyframe ${index + 1}: a new image and ${shots.length === 1 ? "1 shot" : `${shots.length} shots`} · ${credits(total)}`,
      `Shots made again: ${shots.map((shot) => shot.label).join(", ")}`,
      ...(parsed.data.keyframe ? [`New keyframe: ${parsed.data.keyframe}`] : []),
      "The old keyframe and shots stay in your media.",
    ],
  };
}

function findShot(document: ClipDocument, id: string): { declaration: Record<string, unknown>; start: number; end: number } | null {
  let found: { declaration: Record<string, unknown>; start: number; end: number } | null = null;
  const visit = (value: unknown) => {
    if (found || !value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const node = value as Record<string, unknown>;
    const src = (node.paints as { src?: Record<string, unknown> }[] | undefined)?.[0]?.src;
    if (node.id === id && src?.generate === "video") {
      found = { declaration: src, start: Number(node.start ?? 0), end: Number(node.end ?? 0) };
      return;
    }
    (node.children as unknown[] | undefined)?.forEach(visit);
  };
  visit(document.stage);
  return found;
}

/** A shot's spec without its images: the price does not depend on them. */
const pricedSpec = (declaration: Record<string, unknown>): GenerationSpec => ({
  prompt: String(declaration.prompt),
  aspectRatio: String(declaration.aspectRatio),
  duration: Number(declaration.duration),
  ...(typeof declaration.resolution === "string" ? { resolution: declaration.resolution } : {}),
  ...(typeof declaration.audio === "boolean" ? { audio: declaration.audio } : {}),
});

type RunRedoEnv = RedoEnv & {
  applyOp: Parameters<typeof runGeneration>[0]["applyOp"];
  /** Lists the new keyframe in the library as a pending record the editor finishes (`saveKeyframes`). */
  addToLibrary: ListKeyframe;
  alive?: () => Promise<boolean>;
  /** Tests replace the clock and the wait. */
  sleep?: (ms: number) => Promise<void>;
};

const KEYFRAME_WAIT_MS = 120_000;
const KEYFRAME_POLL_MS = 2_000;

/**
 * After approval: the new keyframe first (the shots start on its file), then the shots on it and
 * the op, through `runGeneration` like every priced tool. A keyframe that fails leaves the scene
 * as it was; its credit comes back from the worker.
 */
export async function runRedoKeyframe(env: RunRedoEnv, prepared: PreparedRedo): Promise<{ outcome: ToolOutcome; generationId?: string }> {
  const fail = (message: string) => ({ outcome: { ok: false, content: JSON.stringify({ error: message }), summary: message } });
  // Room for the keyframe and its shots, checked before anything is paid: a refusal after the image
  // would leave the user paying for a keyframe that never reaches the scene.
  const { count: running } = await env.supabase.from("generations").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
  const needed = 1 + prepared.shots.length;
  if ((running ?? 0) + needed > GENERATION_ACTIVE_LIMIT) {
    return fail(`Redoing this keyframe needs ${needed} generations at once and ${running} are still running. Wait for them to finish, then try again.`);
  }
  let keyframeId: string;
  let keyframeCredits: number;
  try {
    const { generation } = await createGeneration(env.supabase, { jobId: env.jobId, clipId: env.clipId, model: prepared.image.model.id, spec: prepared.image.spec, requestId: randomUUID() });
    keyframeId = generation.id;
    keyframeCredits = generation.credits_reserved;
  } catch (err) {
    return fail(err instanceof ApiError && err.status < 500 ? err.message : "The new keyframe could not be started.");
  }
  // From here the keyframe is paid for: every refusal says so.
  const spent = (message: string) => fail(`${message} The new keyframe (${credits(keyframeCredits)}) stays in your media; the scene is unchanged.`);
  // The shots name the keyframe by its declaration and the editor finds its file through this
  // record, so without it the redone shots could never be made: stop before paying for them.
  try {
    await env.addToLibrary({ model: prepared.image.model, spec: prepared.image.spec, folder: prepared.library.folder, name: prepared.library.name }, keyframeId);
  } catch (err) {
    console.error("[agent] redo keyframe: library record failed", keyframeId, err);
    return spent("The new keyframe could not be added to your media. Reload the editor and try again.");
  }
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  for (;;) {
    const { data } = await env.supabase.from("generations").select("status, error").eq("id", keyframeId).maybeSingle<{ status: string; error: string | null }>();
    if (data?.status === "done") break;
    if (data && data.status !== "queued" && data.status !== "running") {
      return fail(`The new keyframe failed: ${data.error ?? "generation failed"}. Its credit comes back; the scene is unchanged.`);
    }
    if (Date.now() - started > KEYFRAME_WAIT_MS) return spent("The new keyframe is taking longer than expected; no shot was started. Try again in a minute.");
    if (env.alive && !(await env.alive())) return spent("The user stopped the assistant; no shot was started.");
    await sleep(KEYFRAME_POLL_MS);
  }
  // Generation ids: `checkGeneration` turns each into its file, under RLS.
  const fileOf = async (frame: unknown): Promise<string | null> => {
    const source = keyframeSource.safeParse(frame);
    const model = source.success ? availableModel(source.data.model) : undefined;
    if (!source.success || !model) return null;
    const hash = specHash(model.id, normalizeSpec(model, keyframeSpec(source.data)));
    const { data } = await env.supabase.from("generations").select("id").eq("job_id", env.jobId).eq("spec_hash", hash).eq("status", "done").limit(1).maybeSingle<{ id: string }>();
    return data?.id ?? null;
  };
  const runs: { model: AiModel; spec: GenerationSpec }[] = [];
  for (const shot of prepared.shots) {
    const { declaration } = shot;
    const start = shot.start ? keyframeId : await fileOf(declaration.startFrame);
    const end = shot.end ? keyframeId : declaration.endFrame ? await fileOf(declaration.endFrame) : undefined;
    if (!start || end === null) return spent("A keyframe next to this one is no longer in your media. Redo that keyframe first.");
    runs.push({ model: shot.model, spec: { ...pricedSpec(declaration), seed: Number(declaration.seed), startImage: start, ...(end ? { endImage: end } : {}) } });
  }
  return runGeneration(
    { supabase: env.supabase, jobId: env.jobId, clipId: env.clipId, applyOp: env.applyOp, ...(env.alive ? { alive: env.alive } : {}) },
    { model: runs[0]!.model, spec: runs[0]!.spec, extra: runs.slice(1), op: prepared.op as never, credits: prepared.credits },
  );
}
