/**
 * Where a long take's keyframes land: numbered stills in `Generated/<title>/keyframes/` of the
 * library, not on the timeline. The server adds them as pending records right after the credits
 * are held; the editor finishes each one like any generation it is waiting for (its POST with the
 * same spec gets the same generation back, so nothing is charged twice).
 */

import { createHash } from "node:crypto";

import { addAsset, createFolder, joinPath, normalizeManifest, uniquePath, type Manifest, type PartialRecord } from "@opencmo/clip-assets";
import type { ClipDocument } from "@opencmo/clip-doc";
import type { CreateVideoResult } from "@opencmo/editor-core";
import type { AiModel, GenerationSpec } from "@opencmo/editor-core/generate";

/** The editor's generation key for an image: `{type, model, spec}` in its field order (`useGenerations.resolve`). */
export function imageKey(model: AiModel, spec: GenerationSpec): string {
  const fields = spec as Record<string, unknown>;
  const pick = (name: string) => (fields[name] !== undefined ? { [name]: fields[name] } : {});
  return JSON.stringify({
    type: "image",
    model: model.id,
    spec: { prompt: spec.prompt, aspectRatio: spec.aspectRatio ?? "16:9", ...pick("resolution"), ...pick("refs"), ...pick("seed") },
  });
}

/** Same record id the editor derives from a key, so both sides name one record the same way. */
const keyId = (key: string) => createHash("sha256").update(`key\n${key}`).digest("hex").slice(0, 16);

export type KeyframeRuns = { model: AiModel; specs: GenerationSpec[]; folder: string; names: string[]; ids: string[]; now: string };

/** The manifest with one pending record per keyframe, in order; a keyframe already listed is kept as it is. */
export function withKeyframes(manifest: unknown, runs: KeyframeRuns): Manifest {
  let current = createFolder(normalizeManifest(manifest), runs.folder);
  runs.specs.forEach((spec, index) => {
    const key = imageKey(runs.model, spec);
    if (current.assets.some((record) => record.generation?.key === key)) return;
    const record: PartialRecord = {
      id: keyId(key),
      path: uniquePath(current, joinPath(runs.folder, runs.names[index] ?? `${String(index + 1).padStart(2, "0")} Keyframe`)),
      type: "IMAGE",
      createdAt: runs.now,
      generation: { key, id: runs.ids[index] ?? null },
      state: "pending",
    };
    current = addAsset(current, record).manifest;
  });
  return current;
}

/** What stage 1 hands to `animate_video`: the plan and each keyframe's generation, by index. */
export function longTakeResult(longTake: Omit<CreateVideoResult, "keyframes">, ids: string[]): CreateVideoResult {
  return {
    plan: longTake.plan,
    aspect: longTake.aspect,
    seconds: longTake.seconds,
    ...(longTake.model ? { model: longTake.model } : {}),
    keyframes: ids.map((generation_id, index) => ({ generation_id, index })),
  };
}

/**
 * Saves the pending keyframe records on the project as it is now. The project moves under us when
 * the open editor autosaves, so a lost optimistic lock reads it again and retries.
 */
export async function saveKeyframes(
  save: { read(): Promise<{ version: number; document: ClipDocument; manifest: unknown }>; write(version: number, document: ClipDocument, manifest: Manifest): Promise<void> },
  runs: Omit<KeyframeRuns, "now">,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const current = await save.read();
    try {
      await save.write(current.version, current.document, withKeyframes(current.manifest, { ...runs, now: new Date().toISOString() }));
      return;
    } catch (err) {
      if (attempt >= 2 || (err as { status?: number }).status !== 409) throw err;
    }
  }
}
