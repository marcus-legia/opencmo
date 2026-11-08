import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { profileIdOf } from "@/lib/cmo/platforms";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

const body = z.object({
  /** The `contentHash` of the card the founder saw. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** The words the founder posted, when not the card's first version (each platform's limit is checked in SQL). */
  text: z.string().max(5000).optional(),
});

/**
 * "I posted it" on a post draft when no account is connected for its platform (cmo-review-2 S2.6): the founder copied
 * it and posted it themselves, so no schedule card should follow. Approves the draft through `approval_decide` (hash,
 * caps, outcomes as for Approve), then marks it posted (`cmo_mark_posted`); the `schedule_follow_content` trigger
 * cancels the schedule slot and card the approval proposed. A platform with a connected account is refused: there the
 * post goes out from the account at an approved time.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, body, params }) => {
    if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Card not found.");
    const { data: approval } = await supabase.from("approvals").select("kind, ref_kind, ref_id").eq("id", params.id).maybeSingle<{ kind: string; ref_kind: string; ref_id: string }>();
    if (!approval || approval.kind !== "post" || approval.ref_kind !== "content_item") throw new ApiError(404, "Post not found.");
    const { data: item } = await supabase.from("content_items").select("platform").eq("id", approval.ref_id).maybeSingle<{ platform: string }>();
    const platform = profileIdOf(item?.platform ?? "") ?? "x";
    const { count } = await supabase.from("social_accounts").select("id", { count: "exact", head: true }).eq("platform", platform).eq("status", "connected");
    if (count) throw new ApiError(409, "This post goes out from your connected account. Approve it and pick its time instead.");

    await rpcOrThrow(supabase, "approval_decide", {
      p_id: params.id,
      p_action: "approve",
      p_payload: { ...(body.text !== undefined ? { text: body.text } : {}), content_hash: body.contentHash, via: "app" },
    });
    await rpcOrThrow(supabase, "cmo_mark_posted", { p_id: approval.ref_id });
    return { ok: true };
  },
);
