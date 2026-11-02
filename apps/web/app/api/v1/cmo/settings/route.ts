import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, withApi } from "@/lib/api/handler";
import { BUDGET_MAX, BUDGET_MIN } from "@/lib/screens/settings";

export const dynamic = "force-dynamic";

type Row = { weekly_credit_budget: number; timezone: string; digest_hour: number | null };

const body = z.object({
  weeklyCreditBudget: z.number().int().min(BUDGET_MIN).max(BUDGET_MAX),
  timezone: z.string().trim().min(1).max(64),
  digestHour: z.number().int().min(0).max(23).nullable(),
});

/** The brain's settings on the Settings page: weekly credit budget, time zone, morning digest hour (null = off). */
export const PUT = withApi(
  { body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, body }) => {
    const row = firstRow(
      await rpcOrThrow<Row | Row[]>(supabase, "save_cmo_settings", {
        p_weekly_credit_budget: body.weeklyCreditBudget,
        p_timezone: body.timezone,
        p_digest_hour: body.digestHour,
      }),
    );
    if (!row) throw new ApiError(500, "Could not save your settings.");
    return { weeklyCreditBudget: row.weekly_credit_budget, timezone: row.timezone, digestHour: row.digest_hour };
  },
);
