/**
 * Where a long take's pieces are listed: its keyframes as numbered stills in
 * `Generated/<title>/keyframes/`, and its shots next to them. The server adds them as pending records
 * carrying the generation it started (paid from the job the user confirmed); the editor finishes each
 * one by waiting on that generation (`useGenerations`), never by asking for it again.
 */

import { createHash } from "node:crypto";

import { addAsset, createFolder, joinPath, normalizeManifest, uniquePath, type Manifest, type PartialRecord } from "@opencmo/clip-assets";
import type { ClipDocument } from "@opencmo/clip-doc";
import type { CreateVideo } from "@opencmo/editor-core";
import type { AiModel, GenerationSpec } from "@opencmo/editor-core/generate";

const pick = (fields: Record<string, unknown>, ...names: string[]) =>
  Object.fromEntries(names.filter((name) => fields[name] !== undefined).map((name) => [name, fields[name]]));

/** The editor's generation key for an image: `{type, model, spec}` in its field order (`useGenerations.resolve`). */
export function imageKey(model: AiModel, spec: GenerationSpec): string {
  const fields = spec as Record<string, unknown>;
  return JSON.stringify({
    type: "image",
    model: model.id,
    spec: { prompt: spec.prompt, aspectRatio: spec.aspectRatio ?? "16:9", ...pick(fields, "resolution", "refs", "seed") },
  });
}

/**
 * The editor's key for a shot `create_video` places (`add_generated` writes the declaration, the editor
 * resolves it): its keyframes are named by their declarations, not by the files they become.
 */
export function shotKey(shot: CreateVideo["shots"][number], aspect: string): string {
  const declaration: Record<string, unknown> = {
    prompt: shot.prompt,
    aspectRatio: aspect,
    duration: shot.duration,
    ...(shot.resolution ? { resolution: shot.resolution } : {}),
    ...(shot.audio !== undefined ? { audio: shot.audio } : {}),
    ...(shot.start_frame ? { startFrame: shot.start_frame } : {}),
    ...(shot.end_frame ? { endFrame: shot.end_frame } : {}),
    ...(shot.after ? { after: shot.after } : {}),
  };
  return JSON.stringify({
    type: "video",
    model: shot.model,
    spec: {
      prompt: declaration.prompt,
      aspectRatio: declaration.aspectRatio,
      duration: declaration.duration,
      ...pick(declaration, "resolution", "audio", "startFrame", "endFrame", "refs", "sourceVideo", "sourceStart", "after"),
      seed: shot.seed,
    },
  });
}

/** Same record id the editor derives from a key, so both sides name one record the same way. */
const keyId = (key: string) => createHash("sha256").update(`key\n${key}`).digest("hex").slice(0, 16);

/** One piece to list: the editor's key for its declaration, the generation already started for it, its name. */
export type LibraryPiece = { key: string; type: "IMAGE" | "VIDEO"; name: string; id: string | null };

/**
 * The manifest with one pending record per piece, in order. A piece already listed gets the generation id
 * when it has none yet: an editor that listed it first would otherwise ask for it again.
 */
export function withPieces(manifest: unknown, folder: string, pieces: LibraryPiece[], now: string): Manifest {
  let current = createFolder(normalizeManifest(manifest), folder);
  for (const piece of pieces) {
    const listed = current.assets.find((record) => record.generation?.key === piece.key);
    if (listed) {
      if (piece.id && !listed.generation?.id) {
        current = {
          ...current,
          assets: current.assets.map((record) => (record === listed ? { ...record, generation: { key: piece.key, id: piece.id } } : record)),
        };
      }
      continue;
    }
    const record: PartialRecord = {
      id: keyId(piece.key),
      path: uniquePath(current, joinPath(folder, piece.name)),
      type: piece.type,
      createdAt: now,
      generation: { key: piece.key, id: piece.id },
      state: "pending",
    };
    current = addAsset(current, record).manifest;
  }
  return current;
}

export type KeyframeRuns = { model: AiModel; specs: GenerationSpec[]; folder: string; names: string[]; ids: string[]; now: string };

/** The manifest with one pending record per keyframe, in order; a keyframe already listed is kept as it is. */
export function withKeyframes(manifest: unknown, runs: KeyframeRuns): Manifest {
  return withPieces(
    manifest,
    runs.folder,
    runs.specs.map((spec, index) => ({
      key: imageKey(runs.model, spec),
      type: "IMAGE" as const,
      name: runs.names[index] ?? `${String(index + 1).padStart(2, "0")} Keyframe`,
      id: runs.ids[index] ?? null,
    })),
    runs.now,
  );
}

export type ProjectStore = {
  read(): Promise<{ version: number; document: ClipDocument; manifest: unknown }>;
  write(version: number, document: ClipDocument, manifest: Manifest): Promise<void>;
};

/**
 * Saves pending records on the project as it is now. The project moves under us when the open editor
 * autosaves, so a lost optimistic lock reads it again and retries.
 */
export async function saveLibrary(save: ProjectStore, change: (manifest: unknown, now: string) => Manifest): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const current = await save.read();
    try {
      await save.write(current.version, current.document, change(current.manifest, new Date().toISOString()));
      return;
    } catch (err) {
      if (attempt >= 2 || (err as { status?: number }).status !== 409) throw err;
    }
  }
}

export async function saveKeyframes(save: ProjectStore, runs: Omit<KeyframeRuns, "now">): Promise<void> {
  await saveLibrary(save, (manifest, now) => withKeyframes(manifest, { ...runs, now }));
}
