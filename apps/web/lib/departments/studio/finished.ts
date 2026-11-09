/**
 * "Mark finished" (P2 F6) and the founder's "Cut shorts". Both are A's RPCs under the founder's RLS
 * session: `mark_finished` compares the hash the founder saw with the saved document, and
 * `cut_shorts_order` refuses an edit that is not finished at its current document. A refusal is an
 * English sentence (`P0001` → 409) that the button shows as is.
 */

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow } from "@/lib/api/handler";

import { renderEdit } from "./render";
import type { MarkedFinished, OrderedShorts, StudioContext } from "./types";

export const DOCUMENT_HASH = /^[0-9a-f]{64}$/;

export async function markFinished(ctx: StudioContext, clipId: string, hash: string): Promise<MarkedFinished> {
  if (!DOCUMENT_HASH.test(hash)) throw new ApiError(422, "Save the edit, then mark it finished.");
  try {
    const row = firstRow(await rpcOrThrow<{ finished_at: string; finished_hash: string } | { finished_at: string; finished_hash: string }[]>(ctx.supabase, "mark_finished", { p_clip_id: clipId, p_document_hash: hash }));
    if (!row) throw new Error("mark_finished returned no project.");
    return { kind: "finished", finishedAt: row.finished_at, hash: row.finished_hash, posting: await startPosting(ctx, clipId) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { kind: "stale", message: err.message };
    throw err;
  }
}

/**
 * The founder's own finished edit goes out (C2, owner 2026-11-09): rendered with the founder's export rights (the same
 * queue and limits as the Export button), then `post_video_start` follows the render to the `finished_video` card.
 * A short, a built video or a Studio slideshow has its own order: nothing starts here.
 */
async function startPosting(ctx: StudioContext, clipId: string): Promise<Extract<MarkedFinished, { kind: "finished" }>["posting"]> {
  // Asked before the render: a render costs one of the founder's daily exports.
  if (!(await rpcOrThrow<boolean>(ctx.supabase, "post_video_wanted", { p_clip_id: clipId }))) return { kind: "none" };
  let taskId: string;
  try {
    taskId = await renderEdit(ctx, clipId);
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) return { kind: "refused", message: err.message };
    throw err;
  }
  const orderId = await rpcOrThrow<string | null>(ctx.supabase, "post_video_start", { p_clip_id: clipId, p_task: taskId });
  return orderId ? { kind: "rendering" } : { kind: "none" };
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
