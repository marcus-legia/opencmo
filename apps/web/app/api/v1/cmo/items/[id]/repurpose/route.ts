import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { kickCmoQueue } from "@/lib/cmo/jobs/start";

export const dynamic = "force-dynamic";
// The rewrite runs in `after()` once the answer is sent: one model call, usually under half a minute.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({ platform: z.enum(["x", "threads", "linkedin", "facebook"]) });

export type RepurposeStarted = { run_id: string; status: string; credits: number; item_id: string; platform: string };

/**
 * "Rewrite for <platform>" on a post card (daily core drafts D4). `repurpose_post` checks the post is the founder's
 * and goes to that platform, and holds the price before anything runs; the rewrite is then written right after this
 * answer and saved as that platform's variant.
 */
export const POST = withApi({ body, rateLimit: { bucket: "cmo-runs", limit: 60, windowSeconds: 3600 } }, async ({ supabase, params, body }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Post not found.");
  const started = await rpcOrThrow<RepurposeStarted>(supabase, "repurpose_post", { p_item: params.id, p_platform: body.platform });
  if (started.status === "queued") kickCmoQueue(started.run_id);
  return started;
});
