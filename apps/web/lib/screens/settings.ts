/**
 * S12 Settings (`Settings.dc.html`).
 */

import { z } from "zod";

import { AccountSchema, CmoStateSchema } from "./common";

/** Bounds of the weekly credit budget; `save_cmo_settings` enforces the same (brain plan W1-1). */
export const BUDGET_MIN = 0;
export const BUDGET_MAX = 10_000;

/** Where a post may go out without the founder's Approve, and the review windows on offer (`save_autopilot`). */
export const AUTOPILOT_PLATFORMS = ["x", "threads", "linkedin"] as const;
export const AUTOPILOT_HOURS = [6, 12, 24] as const;

export const AutopilotSchema = z.object({
  platforms: z.array(z.enum(AUTOPILOT_PLATFORMS)),
  hours: z.union(AUTOPILOT_HOURS.map((h) => z.literal(h))),
  /** Why autopilot turned itself off for a platform, until the founder saves again. */
  note: z.string().max(200).nullable(),
  /** Off from the top bar (`set_autopilot_paused`): nothing counts down, and `platforms` is kept for the way back. */
  paused: z.boolean(),
});
export type Autopilot = z.infer<typeof AutopilotSchema>;

export const SettingsScreenSchema = z.object({
  accounts: z.array(AccountSchema),
  cmo: CmoStateSchema,
  weeklyCreditBudget: z.number().int().min(BUDGET_MIN).max(BUDGET_MAX),
  /** IANA name, for example `Asia/Ho_Chi_Minh`. */
  timezone: z.string().max(64),
  /** Local hour of the morning digest, 0–23; null = off. */
  digestHour: z.number().int().min(0).max(23).nullable(),
  plan: z.object({ name: z.string().max(40), credits: z.number().int().nullable() }),
  autopilot: AutopilotSchema,
});
export type SettingsScreen = z.infer<typeof SettingsScreenSchema>;
