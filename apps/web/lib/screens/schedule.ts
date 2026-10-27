/**
 * S11 Schedule (`Schedule.dc.html`).
 */

import { z } from "zod";

import { AccountSchema, SlotStatusSchema, WhereSchema, iso } from "./common";

export const SlotSchema = z.object({
  id: z.string(),
  at: iso,
  where: WhereSchema,
  title: z.string().max(300),
  status: SlotStatusSchema,
  /** "4.1k views", "reconnect". */
  note: z.string().max(80).nullable(),
  approvalId: z.string().nullable(),
});

export const ScheduleScreenSchema = z.object({
  /** IANA name; every time on the page is shown in it. */
  timezone: z.string().max(64),
  from: iso,
  to: iso,
  slots: z.array(SlotSchema),
  accounts: z.array(AccountSchema),
  rules: z.array(z.string().max(200)),
});
export type ScheduleScreen = z.infer<typeof ScheduleScreenSchema>;
