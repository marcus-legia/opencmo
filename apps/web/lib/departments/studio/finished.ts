/**
 * "Mark finished" (P2 F6) and the founder's "Cut shorts". Both are A's RPCs under the founder's RLS
 * session: `mark_finished` compares the hash the founder saw with the saved document, and
 * `cut_shorts_order` refuses an edit that is not finished at its current document. A refusal is an
 * English sentence (`P0001` → 409) that the button shows as is.
 */

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow } from "@/lib/api/handler";

import type { MarkedFinished, OrderedShorts, StudioContext } from "./types";

export const DOCUMENT_HASH = /^[0-9a-f]{64}$/;

export async function markFinished(ctx: StudioContext, clipId: string, hash: string): Promise<MarkedFinished> {
  if (!DOCUMENT_HASH.test(hash)) throw new ApiError(422, "Save the edit, then mark it finished.");
  try {
    const row = firstRow(await rpcOrThrow<{ finished_at: string; finished_hash: string } | { finished_at: string; finished_hash: string }[]>(ctx.supabase, "mark_finished", { p_clip_id: clipId, p_document_hash: hash }));
    if (!row) throw new Error("mark_finished returned no project.");
    return { kind: "finished", finishedAt: row.finished_at, hash: row.finished_hash };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { kind: "stale", message: err.message };
    throw err;
  }
}

export async function orderShorts(ctx: StudioContext, clipId: string): Promise<OrderedShorts> {
  try {
    const orderId = await rpcOrThrow<string>(ctx.supabase, "cut_shorts_order", { p_clip_id: clipId });
    return { kind: "ordered", orderId };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { kind: "refused", message: err.message };
    throw err;
  }
}
