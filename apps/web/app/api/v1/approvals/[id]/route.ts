import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, withApi, type SupabaseClient } from "@/lib/api/handler";
import { studio } from "@/lib/departments/studio/adapter";
import { APPROVAL_COLUMNS, approvalToCard, type ApprovalRow } from "@/lib/screens/cards";
import { signStudioCards } from "@/lib/screens/studio-sign";

export const dynamic = "force-dynamic";

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
  action: z.enum(["approve", "skip", "replied", "dismissed", "reject", "edit", "redo", "cancel", "send_back"]),
  /** The `contentHash` of the card the founder saw. */
  contentHash: hash,
  text: z.string().max(4000).optional(),
  /** Script card: the beat (0-based) whose words `text` replaces. */
  beat: z.number().int().min(0).max(100).optional(),
  /** Price card: the keyframe (0-based) to make again. */
  index: z.number().int().min(0).max(100).optional(),
  reason: z.string().trim().max(400).optional(),
  goal: z.string().trim().max(300).optional(),
  target: z.number().int().min(1).max(1_000_000).optional(),
});

/**
 * Runs a Studio step the founder just approved (or one keyframe of it again) through the Studio adapter, as MCP and
 * the brain do, and records what happened on the step. The decision itself is already recorded: a step that cannot
 * start is marked failed and the founder is told; it never runs twice.
 */
async function runStudioStep(supabase: SupabaseClient, userId: string, stepId: string, action: "approve" | "redo", index?: number): Promise<void> {
  const finish = (status: "running" | "done" | "failed", error: string | null, generationId?: string) =>
    rpcOrThrow(supabase, "studio_step_finish", { p_id: stepId, p_status: status, p_error: error, p_generation_id: generationId ?? null });
  try {
    const decided = await studio({ supabase, userId, caller: "ui" }).decide({ stepId }, action === "redo" ? { kind: "redo", index: index ?? 0 } : { kind: "approve" });
    if (!decided.outcome.ok) {
      await finish("failed", decided.outcome.summary || "The step could not start.");
      throw new ApiError(422, `Approved, but the step could not start: ${decided.outcome.summary || "please try again"}.`);
    }
    // A redo hands its keyframe to a generation; the new contact sheet comes as a new card when it is done.
    await finish(decided.generationId && action === "approve" ? "running" : "done", null, decided.generationId);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("[approvals] studio step", stepId, error);
    await finish("failed", "The step could not start.").catch(() => undefined);
    throw new ApiError(500, "Approved, but the step could not start. It shows as failed in Studio.");
  }
}

/**
 * Decides one card through `approval_decide`: owner, "already decided" and the snapshot hash are checked there,
 * then the kind's own RPC runs with its caps and outcomes. An approved Studio step then runs through the adapter.
 * Answers the card as it is now.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, user, body, params }) => {
    if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Card not found.");
    const { action, contentHash, ...rest } = body;
    const row = firstRow(
      await rpcOrThrow<ApprovalRow | ApprovalRow[]>(supabase, "approval_decide", {
        p_id: params.id,
        p_action: action,
        p_payload: { ...rest, content_hash: contentHash, via: "app" },
      }),
    );
    if (row?.ref_kind === "studio_step" && (action === "approve" || action === "redo")) {
      await runStudioStep(supabase, user.id, row.ref_id, action, body.index);
    }
    const card = row ? approvalToCard(row) : null;
    if (!card) throw new ApiError(500, "Could not read the card back.");
    return card;
  },
);
