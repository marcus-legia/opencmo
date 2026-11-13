import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { kickCmoQueue } from "@/lib/cmo/jobs/start";

export const dynamic = "force-dynamic";
// The caption is written in `after()` once the answer is sent: one model call.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({ notes: z.string().trim().min(3).max(1000) });

/** "Write the caption" (1 credit, held by `photo_post_caption` before the model runs). */
export const POST = withApi({ body, rateLimit: { bucket: "cmo-runs", limit: 60, windowSeconds: 3600 } }, async ({ supabase, params, body }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Photo post not found.");
  const started = await rpcOrThrow<{ run_id: string; status: string; credits: number }>(supabase, "photo_post_caption", { p_id: params.id, p_notes: body.notes });
  if (started.status === "queued") kickCmoQueue(started.run_id);
  return started;
});
