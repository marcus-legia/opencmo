import { z } from "zod";

import { ApiError, firstRow, rpcOrThrow, withApi } from "@/lib/api/handler";
import { creemPost } from "@/lib/creem";

export const dynamic = "force-dynamic";

const body = z.object({ product: z.literal("annual") });

type Target = { subscription_id: string; product_id: string };

/**
 * Switches a paid founder's monthly plan to the annual one (owner, 2026-11-19). `billing_switch_target` checks that the
 * caller has a live monthly subscription and that the annual product is on sale; Creem then charges the prorated
 * difference at once. Nothing changes on our side here: the webhook does it (`subscription.update` moves the plan,
 * `subscription.paid` grants the month's credits and anchors the year), as for any payment.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "billing_checkout", limit: 20, windowSeconds: 3600 } },
  async ({ supabase, body }) => {
    const target = firstRow(await rpcOrThrow<Target | Target[]>(supabase, "billing_switch_target", { p_slug: body.product }));
    if (!target?.subscription_id || !target.product_id) throw new ApiError(500, "Could not switch your plan. Please try again.");
    await creemPost(`/v1/subscriptions/${encodeURIComponent(target.subscription_id)}/upgrade`, {
      product_id: target.product_id,
      update_behavior: "proration-charge-immediately",
    });
    return { ok: true };
  },
);
