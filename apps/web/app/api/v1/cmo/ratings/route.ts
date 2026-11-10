import { z } from "zod";

import { DRAFT_REASON_CODES } from "@/components/cards/labels";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { kickCmoQueue } from "@/lib/cmo/jobs/start";
import { ratingSheet } from "@/lib/cmo/voice";

export const dynamic = "force-dynamic";

/** The rating sheet (cmo-review-3 2.2): the drafts to rate and the latest round's rules. */
export const GET = withApi({}, async ({ supabase }) => ratingSheet(supabase));

const body = z.object({
  ratings: z
    .array(
      z.object({
        itemId: z.uuid(),
        version: z.number().int().min(0).max(2),
        verdict: z.enum(["up", "down"]),
        reasonCode: z.enum(DRAFT_REASON_CODES).optional(),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(5),
});

/**
 * One round of ratings. `cmo_rate_drafts` checks the drafts are the founder's own and waiting, and holds one round a
 * day; it queues `distill_ratings` (free), which runs right after the answer.
 */
export const POST = withApi({ body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  const out = await rpcOrThrow<{ round: string; run_id: string }>(supabase, "cmo_rate_drafts", {
    p_ratings: body.ratings.map((r) => ({
      item_id: r.itemId,
      version: r.version,
      verdict: r.verdict,
      ...(r.reasonCode ? { reason_code: r.reasonCode } : {}),
      ...(r.note ? { note: r.note } : {}),
    })),
  });
  kickCmoQueue(out.run_id);
  return { round: out.round, runId: out.run_id };
});
