import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One slot per platform the founder picked; each gets a schedule card with its time and account to approve. */
export const POST = withApi({ rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, params }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Photo post not found.");
  const slots = await rpcOrThrow<number>(supabase, "photo_post_schedule", { p_id: params.id });
  return { slots };
});
