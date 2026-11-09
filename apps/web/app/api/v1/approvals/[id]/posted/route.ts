import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";

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
 * it and posted it themselves, so no schedule card follows. `cmo_post_myself` does it in one transaction: the card is
 * approved through `approval_decide` (hash, caps, outcomes as for Approve), the post is marked posted, and the schedule
 * slot and card the approval proposed are cancelled. A connected platform and a thread are refused there.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, body, params }) => {
    if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Card not found.");
    await rpcOrThrow(supabase, "cmo_post_myself", { p_approval: params.id, p_content_hash: body.contentHash, p_text: body.text ?? null });
    return { ok: true };
  },
);
