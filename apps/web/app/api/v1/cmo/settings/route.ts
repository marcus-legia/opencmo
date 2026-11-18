import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, withApi } from "@/lib/api/handler";
import { DIGEST_DAYS } from "@/lib/cmo/digest";
import { BUDGET_MAX, BUDGET_MIN } from "@/lib/screens/settings";

export const dynamic = "force-dynamic";

type Row = { weekly_credit_budget: number; timezone: string; digest_hour: number | null; digest_days: (typeof DIGEST_DAYS)[number] };

// Each panel saves its own fields (Your CMO: budget and time zone; Notifications: the morning email's days and hour):
// a field left out keeps its stored value, so one panel never writes back another's stale copy.
const body = z
  .object({
    weeklyCreditBudget: z.number().int().min(BUDGET_MIN).max(BUDGET_MAX).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    digestHour: z.number().int().min(0).max(23).nullable().optional(),
    digestDays: z.enum(DIGEST_DAYS).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nothing to save.");

/** The brain's settings on the Settings page: weekly credit budget, time zone, the morning email's hour and days. */
export const PUT = withApi(
  { body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, body }) => {
    const { data: current, error } = await supabase
      .from("profiles")
      .select("weekly_credit_budget, timezone, digest_hour")
      .maybeSingle<Pick<Row, "weekly_credit_budget" | "timezone" | "digest_hour">>();
    if (error) throw error;
    if (!current) throw new ApiError(404, "Profile not found.");
    const row = firstRow(
      await rpcOrThrow<Row | Row[]>(supabase, "save_cmo_settings", {
        p_weekly_credit_budget: body.weeklyCreditBudget ?? current.weekly_credit_budget,
        p_timezone: body.timezone ?? current.timezone,
        p_digest_hour: body.digestHour === undefined ? current.digest_hour : body.digestHour,
        p_digest_days: body.digestDays ?? null,
      }),
    );
    if (!row) throw new ApiError(500, "Could not save your settings.");
    return { weeklyCreditBudget: row.weekly_credit_budget, timezone: row.timezone, digestHour: row.digest_hour, digestDays: row.digest_days };
  },
);
