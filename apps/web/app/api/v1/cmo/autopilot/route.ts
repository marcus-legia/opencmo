import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, withApi } from "@/lib/api/handler";
import { AUTOPILOT_HOURS, AUTOPILOT_PLATFORMS } from "@/lib/screens/settings";

export const dynamic = "force-dynamic";

type Row = { autopilot_platforms: string[]; autopilot_hours: number; autopilot_note: string | null };

const body = z.object({
  platforms: z.array(z.enum(AUTOPILOT_PLATFORMS)).max(AUTOPILOT_PLATFORMS.length),
  hours: z.union(AUTOPILOT_HOURS.map((h) => z.literal(h))),
});

/**
 * Autopilot (owner, 2026-11-12): the platforms whose posts go out without the founder's Approve, and the hours they
 * have to change one first. `save_autopilot` holds the rules: a paid plan, a connected account, posts only.
 */
export const PUT = withApi(
  { body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, body }) => {
    const row = firstRow(await rpcOrThrow<Row | Row[]>(supabase, "save_autopilot", { p_platforms: body.platforms, p_hours: body.hours }));
    if (!row) throw new ApiError(500, "Could not save your settings.");
    return { platforms: row.autopilot_platforms, hours: row.autopilot_hours, note: row.autopilot_note };
  },
);
