import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { APPROVAL_COLUMNS, approvalToCard, type ApprovalRow } from "@/lib/screens/cards";
import type { ApprovalCard } from "@/lib/screens/approval-card";
import { enrichScheduleCards } from "@/lib/screens/schedule-enrich";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Up to 4 (`post_photos_save` holds the same number), each under the founder's folder and the post. */
const photoList = z.array(z.string().min(1).max(500)).max(4);
/** `previous`: the photos the card showed, so a card older than the post does not overwrite it. */
const body = z.object({ photos: photoList, previous: photoList });

/**
 * The founder's own photos on a text post, in order (owner, 2026-11-13). Answers the post card that now waits with
 * them (a post in review gets a new card: the photos are part of what is approved), or null once the post is approved,
 * when its schedule cards ask again instead.
 */
export const PUT = withApi({ body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, user, params, body }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Post not found.");
  await rpcOrThrow(supabase, "post_photos_save", { p_item: params.id, p_photos: body.photos, p_previous: body.previous });
  const { data } = await supabase
    .from("approvals")
    .select(APPROVAL_COLUMNS)
    .eq("ref_kind", "content_item")
    .eq("ref_id", params.id)
    .in("status", ["waiting", "held"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as ApprovalRow | null;
  const card = row ? approvalToCard(row) : null;
  return { card: card ? ((await enrichScheduleCards(supabase, user.id, [card]))[0] ?? null) : null } satisfies { card: ApprovalCard | null };
});
