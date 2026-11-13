import { withApi } from "@/lib/api/handler";
import { POST_PHOTO_TYPES } from "@/lib/photo-posts";
import { photoUploadBody, reservePhotoUpload } from "@/lib/photo-uploads";

export const dynamic = "force-dynamic";

/** A reservation for one photo of a text post (owner, 2026-11-13): JPEG or PNG, as every platform of its slot takes. */
export const POST = withApi({ body: photoUploadBody(POST_PHOTO_TYPES), rateLimit: { bucket: "photo-uploads", limit: 120, windowSeconds: 3600 } }, async ({ supabase, user, params, body }) =>
  reservePhotoUpload(supabase, user.id, params.id, body, "Post not found."),
);
