import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, withApi } from "@/lib/api/handler";
import { kickStudioOrders } from "@/lib/cmo/jobs/studio-orders";
import { APPROVAL_COLUMNS, approvalToCard, type ApprovalRow } from "@/lib/screens/cards";
import { signStudioCards } from "@/lib/screens/studio-sign";

export const dynamic = "force-dynamic";
// A Studio decision drains the order runner after the answer (`after()`, 250 s): the function must outlive it, or a
// step stops mid-decide.
export const maxDuration = 300;

const UUID = /^[0-9a-f-]{36}$/i;

/** One card, for `/app/inbox/[id]` (the digest and reminders link here; they never decide). */
export const GET = withApi({}, async ({ supabase, params }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Card not found.");
  const { data } = await supabase.from("approvals").select(APPROVAL_COLUMNS).eq("id", params.id).maybeSingle();
  const row = data as ApprovalRow | null;
  const card = row ? approvalToCard(row) : null;
  if (!card || !row) throw new ApiError(404, "Card not found.");
  return (await signStudioCards(supabase, [card], [row]))[0]!;
});

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const body = z.object({
  action: z.enum(["approve", "skip", "replied", "dismissed", "reject", "edit", "redo", "cancel", "send_back", "edit_caption"]),
  /** The `contentHash` of the card the founder saw. */
  contentHash: hash,
  /** Up to a YouTube description (5,000); each kind's RPC holds its own limit. */
  text: z.string().max(5000).optional(),
  /** Finished-video and shorts cards, `edit_caption`: the caption the founder changes, and YouTube's title. */
  caption: z.uuid().optional(),
  title: z.string().max(100).optional(),
  /** Script card: the beat (0-based) whose words `text` replaces. */
  beat: z.number().int().min(0).max(100).optional(),
  /** Price card: the keyframe (0-based) to make again. */
  index: z.number().int().min(0).max(100).optional(),
  reason: z.string().trim().max(400).optional(),
  goal: z.string().trim().max(300).optional(),
  target: z.number().int().min(1).max(1_000_000).optional(),
});

/**
 * Decides one card through `approval_decide`: owner, "already decided" and the snapshot hash are checked there,
 * then the kind's own RPC runs with its caps and outcomes. A Studio decision is carried out by the brain's order
 * runner (`studio-orders.ts`), kicked here so it starts as soon as the answer is sent.
 * Answers the card as it is now.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, body, params }) => {
    if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Card not found.");
    const { action, contentHash, ...rest } = body;
    const row = firstRow(
      await rpcOrThrow<ApprovalRow | ApprovalRow[]>(supabase, "approval_decide", {
        p_id: params.id,
        p_action: action,
        p_payload: { ...rest, content_hash: contentHash, via: "app" },
      }),
    );
    if (row?.ref_kind === "studio_step" || row?.ref_kind === "short_batch") kickStudioOrders();
    const card = row ? approvalToCard(row) : null;
    if (!card || !row) throw new ApiError(500, "Could not read the card back.");
    // A caption edit keeps the card open on screen: answer it signed, so its previews stay.
    return action === "edit_caption" ? (await signStudioCards(supabase, [card], [row]))[0]! : card;
  },
);
