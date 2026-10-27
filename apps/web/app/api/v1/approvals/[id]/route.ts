import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, withApi } from "@/lib/api/handler";
import { APPROVAL_COLUMNS, approvalToCard, type ApprovalRow } from "@/lib/screens/cards";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** One card, for `/app/inbox/[id]` (the digest and reminders link here; they never decide). */
export const GET = withApi({}, async ({ supabase, params }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Card not found.");
  const { data } = await supabase.from("approvals").select(APPROVAL_COLUMNS).eq("id", params.id).maybeSingle();
  const card = data ? approvalToCard(data as ApprovalRow) : null;
  if (!card) throw new ApiError(404, "Card not found.");
  return card;
});

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const body = z.object({
  action: z.enum(["approve", "skip", "replied", "dismissed", "reject", "edit"]),
  /** The `contentHash` of the card the founder saw. */
  contentHash: hash,
  text: z.string().max(4000).optional(),
  reason: z.string().trim().max(400).optional(),
  goal: z.string().trim().max(300).optional(),
  target: z.number().int().min(1).max(1_000_000).optional(),
});

/**
 * Decides one card through `approval_decide`: owner, "already decided" and the snapshot hash are checked there,
 * then the kind's own RPC runs with its caps and outcomes. Answers the card as it is now.
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
    const card = row ? approvalToCard(row) : null;
    if (!card) throw new ApiError(500, "Could not read the card back.");
    return card;
  },
);
