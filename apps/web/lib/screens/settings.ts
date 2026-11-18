/**
 * S12 Settings (`Settings.dc.html`).
 */

import { z } from "zod";

import { DIGEST_DAYS } from "../cmo/digest";
import { AccountSchema, CmoStateSchema, iso } from "./common";

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

export const EmailLogEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["digest", "weekly", "push", "expiring"]),
  /** The founder's local date the email was for. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["sent", "skipped"]),
  /** Null on a skipped morning. */
  subject: z.string().max(200).nullable(),
  /** How many people, follow-ups and waiting posts the email named; `note` says why a morning was skipped. */
  summary: z
    .object({ people: z.number().int().min(0), followUps: z.number().int().min(0), posts: z.number().int().min(0), note: z.string().max(200).optional() })
    .nullable(),
  at: iso,
});
export type EmailLogEntry = z.infer<typeof EmailLogEntrySchema>;

export const SettingsScreenSchema = z.object({
  accounts: z.array(AccountSchema),
  cmo: CmoStateSchema,
  weeklyCreditBudget: z.number().int().min(BUDGET_MIN).max(BUDGET_MAX),
  /** IANA name, for example `Asia/Ho_Chi_Minh`. */
  timezone: z.string().max(64),
  /** Local hour of the morning digest, 0–23; null = off. */
  digestHour: z.number().int().min(0).max(23).nullable(),
  /** Which days the morning email comes (`profiles.digest_days`). */
  digestDays: z.enum(DIGEST_DAYS),
  /** Emails sent and mornings skipped in the last 14 days, newest first (`my_email_log`). */
  emailLog: z.array(EmailLogEntrySchema).max(30),
  plan: z.object({ name: z.string().max(40), credits: z.number().int().nullable() }),
  autopilot: AutopilotSchema,
});
export type SettingsScreen = z.infer<typeof SettingsScreenSchema>;
