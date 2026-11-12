import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { PHOTO_PLATFORMS, type PhotoPost } from "@/lib/photo-posts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The photo post as it is saved (the caption job writes into it, so the panel reads it again). */
export const GET = withApi({}, async ({ supabase, params }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Photo post not found.");
  const { data, error } = await supabase.from("photo_posts").select("id, photos, caption, platforms, status").eq("id", params.id).maybeSingle<PhotoPost>();
  if (error) throw new ApiError(500, "Could not read this photo post.");
  if (!data) throw new ApiError(404, "Photo post not found.");
  return data;
});

const body = z.object({
  photos: z.array(z.string().min(1).max(500)).max(35),
  caption: z.string().max(2200),
  platforms: z.array(z.enum(PHOTO_PLATFORMS)).max(3),
});

/** The photos in the founder's order, the caption and the platforms; `photo_post_save` holds each platform's count. */
export const PATCH = withApi({ body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, params, body }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Photo post not found.");
  return rpcOrThrow<PhotoPost>(supabase, "photo_post_save", { p_id: params.id, p_photos: body.photos, p_caption: body.caption, p_platforms: body.platforms });
});
