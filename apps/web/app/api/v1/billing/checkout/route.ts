import { randomUUID } from "node:crypto";

import { z } from "zod";

import { ApiError, withApi } from "@/lib/api/handler";
import { creemPost } from "@/lib/creem";
import { isPaidPlan } from "@/lib/pricing";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const body = z.object({ product: z.string().min(1).max(64) });

/**
 * Starts a Creem checkout and returns its URL. The client names a catalogue slug, never a Creem product id, and RLS only
 * shows rows on sale, so a retired price cannot be bought.
 *
 * `metadata.user_id` is what the webhook matches on. The redirect back is only for the user: credits come from the webhook,
 * never from query params on the return URL.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "billing_checkout", limit: 20, windowSeconds: 3600 } },
  async ({ supabase, user, body }) => {
    const [catalog, profile] = await Promise.all([
      supabase.from("billing_catalog").select("creem_product_id, kind").eq("slug", body.product).maybeSingle<{ creem_product_id: string; kind: "plan" | "pack" }>(),
      supabase.from("profiles").select("plan").maybeSingle<{ plan: string }>(),
    ]);
    if (catalog.error) throw catalog.error;
    if (profile.error) throw profile.error;
    if (!catalog.data) throw new ApiError(422, "This product is not on sale.");
    const paid = isPaidPlan(profile.data?.plan);
    // A pack must not replace the subscription.
    if (catalog.data.kind === "pack" && !paid) throw new ApiError(403, "Credit packs are for paid plans. Pick a plan first.");
    // A second checkout would be a second subscription, charged alongside the first.
    if (catalog.data.kind === "plan" && paid) throw new ApiError(409, "You already have a plan. Manage it from this page.");

    const session = await creemPost<{ checkout_url?: unknown }>("/v1/checkouts", {
      product_id: catalog.data.creem_product_id,
      request_id: `${user.id}:${randomUUID()}`,
      metadata: { user_id: user.id },
      ...(user.email ? { customer: { email: user.email } } : {}),
      // Creem refuses 127.0.0.1 as a URL, which is where the local stack runs.
      success_url: absoluteUrl("/app/billing?paid=1").replace("//127.0.0.1", "//localhost"),
    });
    if (typeof session.checkout_url !== "string") throw new ApiError(502, "Could not start the checkout. Please try again.");
    return { checkout_url: session.checkout_url };
  },
);
