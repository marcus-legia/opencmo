/**
 * S8 Writer (`Writer.dc.html`).
 */

import { z } from "zod";

import { PlatformSchema, iso } from "./common";

export const WRITER_KINDS = ["post", "caption", "video_brief", "slide_text"] as const;
export const WRITER_COLUMNS = ["planned", "drafting", "waiting", "scheduled", "posted"] as const;
/** Where a waiting draft's card is: in the queue, held past the day's card budget, or gone (its post still in review). */
export const CARD_STATES = ["waiting", "held", "missing"] as const;

export const DraftSchema = z.object({
  id: z.string(),
  kind: z.enum(WRITER_KINDS),
  platform: PlatformSchema,
  /** When it goes out (or went out); null while drafting without a slot. */
  at: iso.nullable(),
  /** Day label when there is no exact time yet ("Fri"). */
  dayText: z.string().max(20).nullable(),
  /** The calendar day it is planned for ("2026-11-12"): what places it in a week; the label alone does not. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  title: z.string().max(300),
  column: z.enum(WRITER_COLUMNS),
  versions: z.number().int().min(1).max(3),
  /** "You edited 2 lines · results tomorrow", "Approved as drafted". */
  note: z.string().max(120).nullable(),
  approvalId: z.string().nullable(),
  /** An approved script the founder records (2026-11-09): its order, which "Open in editor" opens. */
  scriptId: z.string().nullable().optional(),
  /** Set on a waiting draft only: a held or missing card is not in the queue, so the row offers "Show it now". */
  cardState: z.enum(CARD_STATES).nullable().optional(),
  /** When a held card comes in on its own. */
  heldUntil: iso.nullable().optional(),
  /** What "Show it now" sends to `approval_show_now`. */
  ref: z.object({ kind: z.enum(["content_item", "work_order", "editor_project", "short_batch"]), id: z.string() }).nullable().optional(),
  /** The full words of a post, for a waiting row whose card is not in the queue. */
  text: z.string().max(5000).nullable().optional(),
});

export const VoiceLineSchema = z.object({ text: z.string().max(200), source: z.string().max(120) });

export const WriterScreenSchema = z.object({
  drafts: z.array(DraftSchema),
  voice: z.object({ lines: z.array(VoiceLineSchema), wordsCut: z.array(z.string().max(40)) }),
});
export type WriterScreen = z.infer<typeof WriterScreenSchema>;
