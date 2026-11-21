import { z } from "zod";

import { rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

// The optional Setup questions (CMO review 3, 3.2). `cmo_onboarding_answers` checks every value again in SQL.
const body = z
  .object({
    x_handle: z.string().trim().max(16).regex(/^@?[A-Za-z0-9_]{1,15}$/, "An X handle has 1 to 15 letters, numbers or underscores.").optional(),
    platforms: z.array(z.enum(["x", "threads", "linkedin"])).min(1).max(3).optional(),
    heard_from: z.enum(["search", "x", "reddit", "linkedin", "youtube", "ai_assistant", "friend", "newsletter", "product_hunt", "hacker_news", "threads", "other"]).optional(),
    heard_from_note: z.string().trim().max(100).optional(),
    /** Wave 3, the fit test: who the founder sells to, in a line; it becomes the Strategy's ideal customer. */
    sells_to: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

// The onboarding route's bucket (one allowlisted tuple in `rate_limit_hit`): Setup saves the answers once or twice.
export const POST = withApi({ body, rateLimit: { bucket: "onboarding", limit: 20, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  await rpcOrThrow(supabase, "cmo_onboarding_answers", { p_answers: body });
  return { ok: true };
});
