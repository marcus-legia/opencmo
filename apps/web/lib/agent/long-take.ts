/**
 * Stage 2 of a long take (/video). Stage 1 (`create_video`) made the keyframes; `animate_video`
 * makes the shots between them, each starting on one keyframe and ending on the next, so the cuts
 * disappear. Its card is a contact sheet: the keyframes in order, a Redo per keyframe, and the
 * exact price. After placing, `redo_keyframe` swaps one keyframe of the scene and makes again only
 * the shots that start or end on it.
 *
 * Shot seeds come from the keyframes they join: approving the same card twice, or the Assistant
 * asking again for the same plan, gives the same specs, and the server hands back the generations
 * it already started instead of charging twice.
 */

import { createHash, randomInt, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AnimateVideoInputSchema,
  checkShots,
  keyframeIndexes,
  keyframesOf,
  keyframeSource,
  MASTER_SRC,
  byId,
  RedoKeyframeInputSchema,
  type CreateVideo,
  type KeyframeSource,
} from "@opencmo/editor-core";
import { priceOf, type AiModel, type GenerationSpec } from "@opencmo/editor-core/generate";
import type { ClipDocument } from "@opencmo/clip-doc";

import { ApiError } from "@/lib/api/errors";
import type { SupabaseClient } from "@/lib/api/handler";
import { createGeneration, normalizeSpec } from "@/lib/generate/create";
import { availableModel, availableModels, specHash } from "@/lib/generate/models";

import { credits, GENERATION_ACTIVE_LIMIT, libraryName, minutes, pickMusicModel, pickShotModel, SEPARATE_SHOTS, shotPrompts, timeShots } from "./create-video";
import { runGeneration, voiceModelFor, type PreparedGeneration } from "./generate-tool";
import type { Piece } from "./screen-pieces";
import { sanitize, type ToolOutcome, type ToolSpec } from "./tools";

/** A finished keyframe: its own declaration (what the shots name) and its file in the `media` bucket. */
export type KeyframeFile = { source: KeyframeSource; path: string; garbled: boolean };

/** Finished keyframes by generation id, read under RLS; an id missing from the map is not usable. */
export type ReadKeyframes = (ids: string[]) => Promise<Map<string, KeyframeFile>>;

/** One tile of the contact sheet. */
export type SheetTile = { index: number; words: string; url: string | null; garbled: boolean; credits: number };
export type ContactSheet = { tiles: SheetTile[] };

/** What the card approves, plus each keyframe's spec, so Redo on a tile makes the same image with a new seed. */
export type PreparedAnimate = PreparedGeneration & {
  keyframes: { index: number; generationId: string; model: string; spec: GenerationSpec }[];
};

const firstIssue = (error: z.ZodError) => `${error.issues[0]?.path.join(".") ?? ""}: ${error.issues[0]?.message ?? "Invalid input."}`;

/** A seed fixed by what a piece is made from: the same request gives the same spec, so it is never paid twice. */
function seedOf(...parts: string[]): number {
  return createHash("sha256").update(parts.join("\n")).digest().readUInt32BE(0) & 0x7fffffff;
}

/** Keyframes of this project by generation id: done, an image, and its file still in storage. */
export function keyframeReader(supabase: SupabaseClient, jobId: string): ReadKeyframes {
  return async (ids) => {
    const found = new Map<string, KeyframeFile>();
    if (!ids.length) return found;
    const { data: rows } = await supabase.from("generations").select("id, kind, model, status, spec, media_asset_id, quality").in("id", ids).eq("job_id", jobId);
    const done = ((rows ?? []) as { id: string; kind: string; model: string; status: string; spec: GenerationSpec | null; media_asset_id: string | null; quality?: { text?: string } | null }[])
      .filter((row) => row.kind === "image" && row.status === "done" && row.media_asset_id && typeof row.spec?.seed === "number");
    const { data: assets } = done.length
      ? await supabase.from("media_assets").select("id, storage_path, status").in("id", done.map((row) => row.media_asset_id!))
      : { data: [] };
    const files = new Map(((assets ?? []) as { id: string; storage_path: string; status: string }[]).filter((asset) => asset.status === "ready").map((asset) => [asset.id, asset.storage_path]));
    for (const row of done) {
      const path = files.get(row.media_asset_id!);
      if (!path) continue;
      const spec = row.spec!;
      found.set(row.id, {
        source: {
          generate: "image",
          prompt: spec.prompt,
          model: row.model,
          aspectRatio: String(spec.aspectRatio),
          ...(spec.resolution ? { resolution: spec.resolution } : {}),
          seed: spec.seed!,
        },
        path: path.replace(/^media\//, ""),
        garbled: row.quality?.text === "severe",
      });
    }
    return found;
  };
}

/** The spec a keyframe was made with, read back from its declaration. */
const keyframeSpec = (source: KeyframeSource): GenerationSpec => ({
  prompt: source.prompt,
  aspectRatio: source.aspectRatio,
  ...(source.resolution ? { resolution: source.resolution } : {}),
  seed: source.seed,
});

// ------------------------------------------------------------------ animate_video

export function animateVideoToolSpec(): ToolSpec | null {
  if (!availableModels().some((model) => model.kind === "video" && model.limits.firstFrame)) return null;
  return {
    name: "animate_video",
    description:
      "Second step of a whole AI video (/video): make the shots between the keyframes create_video made, with the voice-over and music, and place them as one scene. Call it once the keyframes are done (wait_for_media), with create_video's plan, aspect, model and keyframe ids. The user sees a contact sheet of the keyframes with the exact video price and approves it; they can redo one keyframe on the sheet, and then you get its new generation id: wait_for_media, then call animate_video again with that keyframe replaced. A keyframe that failed or was deleted is refused: redo it first. read_guide \"video\".",
    schema: sanitize(z.toJSONSchema(AnimateVideoInputSchema, { io: "input" })).schema as Record<string, unknown>,
    strict: true,
    approval: true,
  };
}

type AnimateEnv = {
  document: ClipDocument;
  readKeyframes: ReadKeyframes;
  /** Signed URLs for keyframe files, in order (null = could not sign; the tile shows no picture). */
  sign: (paths: string[]) => Promise<(string | null)[]>;
};

export async function prepareAnimateVideo(input: unknown, env: AnimateEnv): Promise<{ prepared: PreparedAnimate; sheet: ContactSheet; pieces: Piece[] } | string> {
  const parsed = AnimateVideoInputSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const { plan, aspect } = parsed.data;
  if (JSON.stringify(env.document).includes(`"${MASTER_SRC}"`)) {
    return "/video makes a whole new video. Start a New edit for it; on this clip, use /broll or /image for AI shots.";
  }
  // Stage 1 priced the video with this same pick, timing and prompts: the model it chose comes back
  // in the input (a user-named one included), else today's default for the frame.
  const picked = pickShotModel(aspect, parsed.data.model);
  if (typeof picked === "string") return picked;
  const { model: video, joins } = picked;

  const refs = [...parsed.data.keyframes].sort((a, b) => a.index - b.index);
  const files = await env.readKeyframes(refs.map((ref) => ref.generation_id));
  const keyframes: (KeyframeFile & { generationId: string })[] = [];
  for (const ref of refs) {
    const file = files.get(ref.generation_id);
    if (!file) return `Keyframe ${ref.index + 1} is missing. Redo it first.`;
    if (file.source.aspectRatio !== aspect) return `Keyframe ${ref.index + 1} is ${file.source.aspectRatio}; this video is ${aspect}. Redo it first.`;
    keyframes.push({ ...file, generationId: ref.generation_id });
  }

  const durations = [...(video.limits.durations ?? [5])].sort((a, b) => a - b);
  const edges = keyframeIndexes(plan);
  const timed = timeShots(plan, durations);
  const prompts = shotPrompts(plan, video, aspect, joins);
  const shots: CreateVideo["shots"] = [];
  const specs: GenerationSpec[] = [];
  try {
    for (const [index, beat] of plan.shots.entries()) {
      const { start, length, duration } = timed[index]!;
      if (beat.seconds > durations.at(-1)! + 1e-6) return `Shot ${index + 1} is ${beat.seconds}s; a shot is at most ${durations.at(-1)}s. Split it.`;
      const end = joins ? edges[index]!.end : null;
      // It ends on the keyframe the next shot starts on: showing less of it would jump at the seam.
      // The last shot ends on the closing keyframe, which no shot starts from, so it may stop short.
      if (end !== null && index < plan.shots.length - 1 && Math.abs(duration - length) > 1e-6) {
        return `Shot ${index + 1} is ${length}s but ends on keyframe ${end + 1}, so it must be exactly one of ${durations.join(", ")}s.`;
      }
      const first = keyframes[edges[index]!.start]!;
      const last = end === null ? undefined : keyframes[end]!;
      const seed = seedOf(video.id, first.generationId, last?.generationId ?? "cut", String(duration));
      const { prompt } = prompts[index]!;
      const audio = video.limits.audio ? { audio: false } : {};
      specs.push(normalizeSpec(video, { prompt, aspectRatio: aspect, duration, seed, startImage: first.path, ...(last ? { endImage: last.path } : {}), ...audio }));
      shots.push({
        start,
        length,
        model: video.id,
        prompt,
        seed,
        duration,
        ...(beat.text ? { text: beat.text } : {}),
        start_frame: first.source,
        ...(last ? { end_frame: last.source } : {}),
        ...audio,
      });
    }
  } catch (err) {
    return err instanceof ApiError ? err.message : "Invalid shot.";
  }
  const seconds = Math.round((timed.at(-1)!.start + timed.at(-1)!.length) * 10) / 10;
  if (seconds < 3) return "A video is at least 3 seconds long. Make the shots longer.";
  const problem = checkShots({ seconds, shots });
  if (problem) return problem;

  const extra: { model: AiModel; spec: GenerationSpec }[] = specs.slice(1).map((spec) => ({ model: video, spec }));
  const pieces: Piece[] = specs.map((spec, index) => ({ label: `Shot ${index + 1} (${plan.shots[index]!.words.slice(0, 60)})`, spec, kind: "video" }));
  const named = parsed.data.voice ? voiceModelFor(parsed.data.voice) : null;
  if (typeof named === "string") return named;
  const voiceModel = named ?? availableModels().find((model) => model.kind === "voice");
  let voice: CreateVideo["voice"];
  const name = voiceModel && (parsed.data.voice && voiceModel.limits.voices?.includes(parsed.data.voice) ? parsed.data.voice : voiceModel.limits.voices?.[0]);
  if (voiceModel && name) {
    voice = { text: plan.script, voice: name, seed: seedOf("voice", plan.script, name) };
    const spec = normalizeSpec(voiceModel, { prompt: voice.text, voice: name, seed: voice.seed });
    extra.push({ model: voiceModel, spec });
    pieces.push({ label: "The voice-over script", spec, kind: "voice" });
  }
  const musicModel = pickMusicModel();
  let music: CreateVideo["music"];
  if (musicModel) {
    const duration = Math.min(musicModel.limits.maxSeconds ?? seconds, Math.max(musicModel.limits.minSeconds ?? 1, Math.ceil(seconds)));
    const prompt = `Instrumental only, no vocals. ${plan.music}`;
    music = { model: musicModel.id, prompt, seed: seedOf("music", prompt, String(duration)), duration };
    const spec = normalizeSpec(musicModel, { prompt, duration, seed: music.seed });
    extra.push({ model: musicModel, spec });
    pieces.push({ label: "The music", spec, kind: "audio" });
  }

  const op: CreateVideo = { op: "create_video", aspect, seconds, title: plan.title, shots, ...(voice ? { voice } : {}), ...(music ? { music } : {}) };
  const shotCredits = specs.reduce((sum, spec) => sum + priceOf(video, spec), 0);
  const total = shotCredits + extra.slice(specs.length - 1).reduce((sum, item) => sum + priceOf(item.model, item.spec), 0);
  const garbled = keyframes.map((keyframe, index) => (keyframe.garbled ? index + 1 : 0)).filter(Boolean);
  const urls = await env.sign(keyframes.map((keyframe) => keyframe.path)).catch(() => keyframes.map(() => null));
  return {
    prepared: {
      model: video,
      spec: specs[0]!,
      op: op as never,
      credits: total,
      extra,
      lines: [
        `Animate a ${seconds}s ${aspect} video: ${shots.length === 1 ? "1 shot" : `${shots.length} shots`} on ${keyframes.length} keyframes${voice ? `, voice-over (${voice.voice})` : ""}${music ? ", music" : ""} · ${credits(total)}${video.limits.typicalSeconds ? `, ready in ${minutes(video.limits.typicalSeconds + 60)}` : ""}`,
        `Shots on ${video.name} · ${credits(shotCredits)}`,
        ...(joins ? [] : [SEPARATE_SHOTS]),
        ...(garbled.length ? [`Keyframe ${garbled.join(", ")} may have garbled text. Redo it before you approve.`] : []),
      ],
      keyframes: keyframes.map((keyframe, index) => ({ index, generationId: keyframe.generationId, model: keyframe.source.model, spec: keyframeSpec(keyframe.source) })),
    },
    sheet: {
      tiles: keyframes.map((keyframe, index) => {
        const model = availableModel(keyframe.source.model);
        return {
          index,
          words: plan.shots[index]?.words ?? "Closing frame",
          url: urls[index] ?? null,
          garbled: keyframe.garbled,
          credits: model ? priceOf(model, keyframeSpec(keyframe.source)) : 0,
        };
      }),
    },
    pieces,
  };
}

type RedoEnv = { supabase: SupabaseClient; jobId: string; clipId: string };

/** Lists a new keyframe in the library as a pending record the editor finishes (`saveKeyframes`). */
export type ListKeyframe = (entry: { model: AiModel; spec: GenerationSpec; folder: string; name: string }, generationId: string) => Promise<void>;

/**
 * Redo on a contact-sheet tile, approved in the card at its own price: one new image of that
 * keyframe with a new seed. The sheet itself is not approved; the Assistant asks again with the
 * new keyframe, so the user sees the new tile and price before any shot is paid for.
 */
export async function redoSheetKeyframe(env: RedoEnv & { addToLibrary: ListKeyframe }, prepared: PreparedAnimate, index: number): Promise<ToolOutcome> {
  const keyframe = prepared.keyframes.find((item) => item.index === index);
  const model = keyframe ? availableModel(keyframe.model) : undefined;
  if (!keyframe || !model) {
    const message = keyframe ? "That keyframe's image model is not available any more." : `There is no keyframe ${index + 1}.`;
    return { ok: false, content: JSON.stringify({ error: message }), summary: message };
  }
  try {
    const spec = { ...keyframe.spec, seed: randomInt(0, 2_147_483_647) };
    const { generation } = await createGeneration(env.supabase, { jobId: env.jobId, clipId: env.clipId, model: model.id, spec, requestId: randomUUID() });
    // The shots name this keyframe by its declaration and the editor finds its file through the
    // library record: without it, the shots stage 2 places could never be made in the editor.
    const title = libraryName(String((prepared.op as unknown as { title?: string }).title ?? "Video"));
    try {
      await env.addToLibrary({ model, spec, folder: `Generated/${title}/keyframes`, name: `${String(index + 1).padStart(2, "0")} Keyframe (redo)` }, generation.id);
    } catch (err) {
      console.error("[agent] redo keyframe: library record failed", generation.id, err);
      const message = `The new keyframe ${index + 1} was started (${credits(generation.credits_reserved)}) but could not be added to your media. Reload the editor and try Redo again before approving the video.`;
      return { ok: false, content: JSON.stringify({ error: message, generation_id: generation.id }), summary: message };
    }
    return {
      ok: true,
      content: JSON.stringify({
        redone: true,
        keyframe_index: index,
        generation_id: generation.id,
        credits: generation.credits_reserved,
        next: `The user redid keyframe ${index + 1} instead of approving the video. Call wait_for_media, then animate_video again with the same plan, aspect, model and keyframes, keyframe index ${index} now generation ${generation.id}. Nothing else was paid for.`,
      }),
      summary: `Redoing keyframe ${index + 1} (${credits(generation.credits_reserved)})`,
    };
  } catch (err) {
    const message = err instanceof ApiError && err.status < 500 ? err.message : "The keyframe could not be redone.";
    if (!(err instanceof ApiError)) console.error("[agent] redo keyframe failed", err);
    return { ok: false, content: JSON.stringify({ error: message }), summary: message };
  }
}

// ------------------------------------------------------------------ redo_keyframe

export function redoKeyframeToolSpec(): ToolSpec | null {
  if (!availableModels().some((model) => model.kind === "video" && model.limits.firstFrame)) return null;
  return {
    name: "redo_keyframe",
    description:
      "Redo one keyframe of a long-take scene already on the timeline (the sequence animate_video placed): one new image, then only the shots that start or end on it (at most two) are made again; every other shot stays. Use it when the user wants one moment of the video changed. scene_id = the sequence's id; index = the keyframe's position, 0 for the first. keyframe = an optional new description of that frame (subject, place, light, framing; never text). The user approves the price; the old keyframe and shots stay in the library, and Undo brings them back.",
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
  if (!keyframes) return "That is not a long-take scene. Use the id of the sequence animate_video placed.";
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
