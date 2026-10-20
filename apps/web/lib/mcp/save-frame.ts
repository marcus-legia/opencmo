/**
 * `save_frame` over MCP (editor-MCP plan, item 1): one frame of the clip, without text or captions, saved to
 * the library folder Frames so `generate_media` can use it as `start_image` / `end_image`.
 *
 * It takes the same steps as the editor's upload (`components/editor/library/store.ts`), every write
 * through an ownership-checking RPC under the user's RLS:
 * 1. the worker draws the frame (`look` op `frame`, the export's renderer, text left out);
 * 2. `reserve_upload` for `media/<user>/<project>/<uuid>.jpg`, then the bytes go to Storage with the
 *    user's own token (Storage RLS refuses an object without that reservation);
 * 3. `register_media_asset` creates the asset and queues its probe task (one transaction), then the
 *    worker is woken;
 * 4. the library record is added to the project's manifest with `save_editor_document`.
 *
 * The bytes pass through the MCP server on Modal, never through Next.js on Vercel (web rule 3).
 *
 * UNTESTED end to end (2026-10-20): needs a database, Storage, the deployed `look` endpoint and the
 * probe task; only the manifest step (`frameRecord`) runs in `save-frame.check.ts`. Note: an image
 * model needs fal budget, which is why the plan ranks this last.
 */

import { randomUUID } from "node:crypto";

import { addAsset, normalizeManifest, type Manifest } from "@opencmo/clip-assets";
import { z } from "zod";

import { clipContext } from "@/lib/api/clips";
import { rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";
import { saveDocument } from "@/lib/editor/document";
import { ensureBlankProject, ensureEditorProject } from "@/lib/editor/project";
import { wakeWorker } from "@/lib/modal";

import { requestLook } from "./look";

export const saveFrameInput = z.object({
  clip_id: z.string().uuid(),
  time: z.number().min(0).describe("Clip-timeline second of the frame."),
  name: z.string().trim().max(60).optional().describe("A file name for it, e.g. before-cut."),
});

export type SaveFrameAnswer = { images: string[]; data: Record<string, unknown> } | { error: string };

/** The manifest with the frame's record in Frames/ (a free path), and that record's path. */
export function frameRecord(
  manifest: unknown,
  frame: { stem: string; mediaId: string; width: number; height: number; now: string; id?: string },
): { manifest: Manifest; path: string } {
  const current = normalizeManifest(manifest);
  const folders = current.folders.includes("Frames") ? current.folders : [...current.folders, "Frames"];
  const path = `Frames/${frame.stem}.jpg`;
  const added = addAsset(
    { ...current, folders },
    {
      id: frame.id ?? randomUUID(),
      path,
      source: `assets/${path}`,
      type: "IMAGE",
      mimeType: "image/jpeg",
      createdAt: frame.now,
      width: frame.width,
      height: frame.height,
      cloud: { state: "synced", mediaId: frame.mediaId },
    },
  );
  return { manifest: added.manifest, path: added.record.path };
}

export const frameStem = (time: number, name?: string) => (name || `frame-${time.toFixed(1)}s`).replace(/[^\w.-]+/g, "-").slice(0, 60);

export async function saveFrame(supabase: SupabaseClient, userId: string, input: z.infer<typeof saveFrameInput>): Promise<SaveFrameAnswer> {
  const shot = await requestLook(supabase, userId, "frame", { clip_id: input.clip_id, time: input.time, edge: 1280 });
  if ("error" in shot) return shot;
  const base64 = shot.images[0];
  if (!base64) return { error: "The frame could not be drawn." };
  const bytes = Buffer.from(base64, "base64");

  const context = await clipContext(supabase, input.clip_id);
  const jobId = context.clip.job_id;
  const objectName = `${userId}/${jobId}/${randomUUID()}.jpg`;
  // Same reservation the editor's upload asks for (`/api/v1/uploads`, kind "media").
  await rpcOrThrow(supabase, "reserve_upload", { p_bucket: "media", p_object_name: objectName, p_size: bytes.length, p_content_type: "video/x-upload", p_project_id: jobId });
  const { error: uploadError } = await supabase.storage.from("media").upload(objectName, bytes, { contentType: "image/jpeg", upsert: false });
  if (uploadError) return { error: "The frame could not be saved to the library. Try again." };

  const stem = frameStem(input.time, input.name);
  const registered = await rpcOrThrow<{ asset: { id: string; status: string }; task_id: string | null }>(supabase, "register_media_asset", {
    p_job_id: jobId,
    p_storage_path: `media/${objectName}`,
    p_name: `${stem}.jpg`,
    p_request_id: randomUUID(),
  });
  if (registered.task_id) await wakeWorker({ task_id: registered.task_id });

  const project = context.clip.kind === "blank" ? await ensureBlankProject(supabase, context, input.clip_id) : await ensureEditorProject(supabase, context, input.clip_id);
  const width = Number(shot.data.width) || 0;
  const height = Number(shot.data.height) || 0;
  const { manifest, path } = frameRecord(project.manifest, { stem, mediaId: registered.asset.id, width, height, now: new Date().toISOString() });
  await saveDocument(supabase, input.clip_id, project.version, project.document, { manifest });

  return {
    images: [base64],
    data: {
      path,
      saved: registered.asset.status === "ready",
      message:
        registered.asset.status === "ready"
          ? `Saved as ${path}. Use it as start_image or end_image.`
          : `Saved as ${path}; it is being checked and is usable as start_image or end_image in a few seconds (wait_for_media or list_library shows when).`,
    },
  };
}
