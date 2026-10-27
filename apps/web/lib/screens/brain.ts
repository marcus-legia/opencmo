/**
 * S5 Brain (`Brain.dc.html`): tabs This week / Memory / Past weeks; the order tree with credits and states;
 * what the brain learned, each note with its source.
 */

import { z } from "zod";

import { CmoStateSchema, CreditsSchema, DepartmentSchema, day, iso } from "./common";

/** Same values as `work_orders.status` (brain plan W1-3). */
export const ORDER_STATES = ["queued", "running", "waiting_founder", "waiting_order", "deferred", "done", "failed", "cancelled"] as const;
export const OrderStateSchema = z.enum(ORDER_STATES);
export type OrderState = z.infer<typeof OrderStateSchema>;

export const OrderRowSchema = z.object({
  id: z.string(),
  /** Null for a top-level order of the week (the week root itself is not a row). */
  parentId: z.string().nullable(),
  title: z.string().max(200),
  department: DepartmentSchema,
  dueAt: iso.nullable(),
  /** "Mon–Sat" style range when the order spans days; null when `dueAt` says it. */
  dueText: z.string().max(40).nullable(),
  credits: CreditsSchema,
  state: OrderStateSchema,
  /** The state cell: "1 waits on you", "Stuck: budget", "Waits on video". */
  stateText: z.string().max(80),
  /** A card to open from the row ("Open"). */
  approvalId: z.string().nullable(),
});
export type OrderRow = z.infer<typeof OrderRowSchema>;

/** A note the brain learned. `kind` picks the label; `source` says where it came from. */
export const LearnedSchema = z.object({
  id: z.string(),
  kind: z.enum(["lesson", "rule", "skip_reason", "goal_result", "memory"]),
  /** The label after the kind: "X", "you approved", "Sales", "last week". */
  scope: z.string().max(40),
  text: z.string().max(300),
  source: z.string().max(200),
  at: iso,
  /** The founder may delete it (corrections and memories; lessons are rewritten each Sunday). */
  deletable: z.boolean(),
});
export type Learned = z.infer<typeof LearnedSchema>;

/** A rule from edits waiting for the founder, or active, or rejected (`cmo_corrections`). */
export const CorrectionRowSchema = z.object({
  id: z.string(),
  rule: z.string().max(200),
  status: z.enum(["proposed", "active", "rejected"]),
  at: iso,
  approvalId: z.string().nullable(),
});

export const PastWeekSchema = z.object({
  week: day,
  goal: z.string().max(200).nullable(),
  /** "Missed: 3 of 5 posts went out (Threads disconnected)." */
  result: z.string().max(300),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  credits: CreditsSchema,
});

export const BrainScreenSchema = z.object({
  cmo: CmoStateSchema,
  week: z.object({
    goal: z.string().max(200).nullable(),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
    credits: CreditsSchema,
    /** When the daily progress check runs next. */
    nextCheckAt: iso.nullable(),
  }),
  /** Parents before their children. */
  orders: z.array(OrderRowSchema),
  learned: z.array(LearnedSchema),
  corrections: z.array(CorrectionRowSchema),
  pastWeeks: z.array(PastWeekSchema),
});
export type BrainScreen = z.infer<typeof BrainScreenSchema>;
