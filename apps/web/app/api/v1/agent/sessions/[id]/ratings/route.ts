import { z } from "zod";

import { notFound, rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const body = z.object({
  turn: z.number().int().min(1).max(100_000),
  /** null clears the rating. */
  rating: z.enum(["up", "down"]).nullable(),
  reason: z.string().trim().min(1).max(300).optional(),
});

/** Thumbs on one answer of the founder's CMO chat (plan 2026-11-02-cmo-chat-live). The RPC checks the session is theirs. */
export const POST = withApi({ body, rateLimit: { bucket: "feedback-turn", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body, params }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.id ?? "")) throw notFound("Assistant session not found.");
  await rpcOrThrow(supabase, "rate_agent_turn", { p_session: params.id, p_turn: body.turn, p_rating: body.rating, p_reason: body.reason ?? null });
  return { turn: body.turn, rating: body.rating };
});
