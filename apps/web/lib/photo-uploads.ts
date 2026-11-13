import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow } from "@/lib/api/handler";
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from "@/lib/photo-posts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT: Record<(typeof PHOTO_TYPES)[number], string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** What a photo upload asks for: its size and type, among the types its post takes. */
export const photoUploadBody = (types: readonly [(typeof PHOTO_TYPES)[number], ...(typeof PHOTO_TYPES)[number][]]) =>
  z.object({ size: z.number().int().positive().max(PHOTO_MAX_BYTES), type: z.enum(types) });

// TODO(storage): uploads move from Supabase Storage to DigitalOcean storage later this week
// (owner, 2026-11-13); keep this path as it is until then.
/**
 * A reservation for one photo under a post (a photo post's draft or a text post): the browser then sends the bytes
 * to Storage over TUS, never through Next.js. The object name is ours, under the founder's folder and the post;
 * `reserve_upload` checks the post is the founder's and takes this kind of photo.
 */
export async function reservePhotoUpload(
  supabase: SupabaseClient,
  userId: string,
  postId: string | undefined,
  body: { size: number; type: (typeof PHOTO_TYPES)[number] },
  notFound: string,
): Promise<{ bucket: "photos"; objectName: string }> {
  if (!UUID.test(postId ?? "")) throw new ApiError(404, notFound);
  const objectName = `${userId}/${postId}/${randomUUID()}.${EXT[body.type]}`;
  await rpcOrThrow(supabase, "reserve_upload", { p_bucket: "photos", p_object_name: objectName, p_size: body.size, p_content_type: body.type, p_project_id: postId });
  return { bucket: "photos", objectName };
}
