import { randomUUID } from "node:crypto";

import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from "@/lib/photo-posts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT: Record<(typeof PHOTO_TYPES)[number], string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const body = z.object({ size: z.number().int().positive().max(PHOTO_MAX_BYTES), type: z.enum(PHOTO_TYPES) });

/**
 * A reservation for one photo of the post: the browser then sends the bytes to Storage over TUS (`upload-tus.ts`),
 * never through Next.js. The object name is ours, under the founder's folder and the post.
 */
export const POST = withApi({ body, rateLimit: { bucket: "photo-uploads", limit: 120, windowSeconds: 3600 } }, async ({ supabase, user, params, body }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Photo post not found.");
  const objectName = `${user.id}/${params.id}/${randomUUID()}.${EXT[body.type]}`;
  await rpcOrThrow(supabase, "reserve_upload", { p_bucket: "photos", p_object_name: objectName, p_size: body.size, p_content_type: body.type, p_project_id: params.id });
  return { bucket: "photos", objectName };
});
