import { ApiError, withApi } from "@/lib/api/handler";
import { creemPost } from "@/lib/creem";

export const dynamic = "force-dynamic";

/** A link to Creem's customer portal. Cancelling there is immediate: the plan ends at once (`subscription.canceled`). */
export const POST = withApi(
  { rateLimit: { bucket: "billing_portal", limit: 20, windowSeconds: 3600 } },
  async ({ supabase }) => {
    // RLS: the caller's own row, so the customer id can only be their own.
    const { data, error } = await supabase.from("profiles").select("creem_customer_id").maybeSingle<{ creem_customer_id: string | null }>();
    if (error) throw error;
    if (!data?.creem_customer_id) throw new ApiError(404, "No billing account yet.");
    const portal = await creemPost<{ customer_portal_link?: unknown }>("/v1/customers/billing", { customer_id: data.creem_customer_id });
    if (typeof portal.customer_portal_link !== "string") throw new ApiError(502, "Could not open billing. Please try again.");
    return { url: portal.customer_portal_link };
  },
);
