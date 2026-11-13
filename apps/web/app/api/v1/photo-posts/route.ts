import { rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

/**
 * A new photo post (daily core drafts D7): the founder's own photos, posted as a TikTok photo post or an Instagram or
 * Threads carousel. It starts as a draft the photos upload into.
 */
export const POST = withApi({ rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase }) => {
  const id = await rpcOrThrow<string>(supabase, "photo_post_create", {});
  return { id };
});
