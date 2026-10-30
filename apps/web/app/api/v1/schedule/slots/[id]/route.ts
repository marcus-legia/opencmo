import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, withApi } from "@/lib/api/handler";
import { approvalToCard, type ApprovalRow } from "@/lib/screens/cards";
import { enrichScheduleCards } from "@/lib/screens/schedule-enrich";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

const body = z.discriminatedUnion("action", [
  /** The calendar's drag (or its Move picker): a new time, with its offset; the slot asks again with a new card. */
  z.object({ action: z.literal("change_time"), publishAt: z.iso.datetime({ offset: true }) }).strict(),
  /** "I posted it" on a copy-and-open card: the founder posted it themselves. */
  z.object({ action: z.literal("posted") }).strict(),
]);

/**
 * One schedule slot, by its id rather than its card (P4 C2): the calendar moves slots it has no card hash for (an
 * approved slot has no waiting card), and "I posted it" is not a decision on the card's content. Ownership, the
 * slot's state and the rules (gap, daily cap, window) are checked in SQL. Answers the card that now stands for it.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, user, body, params }) => {
    if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Slot not found.");
    const row = firstRow(
      body.action === "change_time"
        ? await rpcOrThrow<ApprovalRow | ApprovalRow[]>(supabase, "schedule_change", {
            p_slot: params.id,
            p_action: "change_time",
            p_payload: { publish_at: body.publishAt },
          })
        : await rpcOrThrow<ApprovalRow | ApprovalRow[]>(supabase, "schedule_mark_posted", { p_slot: params.id }),
    );
    const card = row ? approvalToCard(row) : null;
    if (!card) throw new ApiError(500, "Could not read the card back.");
    return (await enrichScheduleCards(supabase, user.id, [card]))[0]!;
  },
);
