import { z } from "zod";

import { rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

/** The event whose Undo the founder pressed: SQL refuses when a newer change came in since the page loaded. */
const body = z.object({ eventId: z.uuid() });

/** Undo on the Voice page: reverts the founder's latest change not undone yet (`cmo_voice_undo`). */
export const POST = withApi({ body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  await rpcOrThrow(supabase, "cmo_voice_undo", { p_event: body.eventId });
  return { ok: true };
});
