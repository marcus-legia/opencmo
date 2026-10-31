import { z } from "zod";

import { rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const body = z.object({ paused: z.boolean() });

/**
 * Pause CMO / Resume. Pausing stops every run within a minute and starts nothing new; nothing is deleted
 * (`cmo_pause`, `cmo_resume`). Answers the new state.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, body }) => {
    if (body.paused) {
      const pausedAt = await rpcOrThrow<string>(supabase, "cmo_pause", {});
      return { pausedAt };
    }
    await rpcOrThrow(supabase, "cmo_resume", {});
    return { pausedAt: null };
  },
);
