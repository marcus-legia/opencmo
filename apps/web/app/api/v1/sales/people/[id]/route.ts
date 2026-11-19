import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { PERSON_STATUSES } from "@/lib/cmo/reach";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  // "I replied": the link to the founder's reply, so the thread can be read again for an answer.
  z.object({ action: z.literal("reply_link"), url: z.string().trim().min(8).max(500) }),
  // Following up: where the person stands now (talking, signed up, customer, not interested…).
  z.object({ action: z.literal("status"), status: z.enum(PERSON_STATUSES) }),
]);

/**
 * One person Sales found, after the founder reached out (wave 3, A3's founder RPCs): the reply's link
 * (`opportunity_mark_replied`, which checks it is on the thread's site) or the person's status (`opportunity_set_status`).
 * Nothing is sent from here: the founder replies, DMs and emails from their own account.
 */
export const POST = withApi({ body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body, params }) => {
  const id = params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) throw new ApiError(404, "Conversation not found.");
  const row =
    body.action === "reply_link"
      ? await rpcOrThrow<{ person_status: string; reply_url: string | null }>(supabase, "opportunity_mark_replied", { p_id: id, p_url: body.url })
      : await rpcOrThrow<{ person_status: string; reply_url: string | null }>(supabase, "opportunity_set_status", { p_id: id, p_status: body.status });
  return { status: row.person_status, replyUrl: row.reply_url };
});
