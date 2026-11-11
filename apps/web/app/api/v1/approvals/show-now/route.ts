import { z } from "zod";

import { rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const body = z.object({
  refKind: z.enum(["content_item", "work_order", "editor_project", "short_batch"]),
  refId: z.string().uuid(),
});

/**
 * "Show it now" on a draft the Writer lists as waiting whose card is not in the queue: held past the day's card
 * budget, or lost while its post stayed in review. `approval_show_now` checks the owner and releases or raises it.
 */
export const POST = withApi({ body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  const id = await rpcOrThrow(supabase, "approval_show_now", { p_ref_kind: body.refKind, p_ref_id: body.refId });
  return { ok: true, id };
});
