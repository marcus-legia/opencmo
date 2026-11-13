import { withApi } from "@/lib/api/handler";
import { PHOTO_TYPES } from "@/lib/photo-posts";
import { photoUploadBody, reservePhotoUpload } from "@/lib/photo-uploads";

export const dynamic = "force-dynamic";

/** A reservation for one photo of a photo post's draft (D7); `reservePhotoUpload` holds the rules. */
export const POST = withApi({ body: photoUploadBody(PHOTO_TYPES), rateLimit: { bucket: "photo-uploads", limit: 120, windowSeconds: 3600 } }, async ({ supabase, user, params, body }) =>
  reservePhotoUpload(supabase, user.id, params.id, body, "Photo post not found."),
);
