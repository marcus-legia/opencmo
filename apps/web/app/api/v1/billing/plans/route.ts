import { withApi } from "@/lib/api/handler";
import { plansOnSale } from "@/lib/billing-catalog";
import type { PlanOffer } from "@/lib/plan-offer";

export const dynamic = "force-dynamic";

/**
 * The plans on sale, for the plan sheet a 402 `plan_required` opens (CMO review 3, B0). Prices come from
 * `billing_catalog` only; a plan without a row is left out rather than shown without a price.
 */
export const GET = withApi({}, async () => {
  const plans = await plansOnSale();
  const offers: PlanOffer[] = plans.flatMap((plan) =>
    plan.id !== "free" && plan.slug
      ? [
          {
            slug: plan.slug,
            name: plan.name,
            price: plan.price,
            billedPrice: plan.billedPrice,
            listPrice: plan.listPrice ?? null,
            interval: plan.interval,
            credits: plan.credits,
            highlight: Boolean(plan.highlight),
          },
        ]
      : [],
  );
  return { plans: offers };
});
