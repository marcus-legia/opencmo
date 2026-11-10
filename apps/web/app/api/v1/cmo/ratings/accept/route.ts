import { z } from "zod";

import { rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const body = z.object({
  round: z.uuid(),
  /** The ticked rules, with the founder's words; the round's other rules are set aside. */
  rules: z.array(z.object({ id: z.uuid(), text: z.string().trim().min(3).max(200) })).max(5),
});

/** "Use these rules" (cmo-review-3 2.2): one transaction, no card per rule (`cmo_accept_corrections`). */
export const POST = withApi({ body, rateLimit: { bucket: "presets", limit: 30, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  const accepted = await rpcOrThrow<number>(supabase, "cmo_accept_corrections", {
    p_round: body.round,
    p_ids: body.rules.map((r) => r.id),
    p_texts: body.rules.map((r) => r.text),
  });
  return { accepted };
});
