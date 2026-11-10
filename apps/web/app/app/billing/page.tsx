import { BillingButton } from "@/components/billing/BillingButton";
import { BillingV2 } from "@/components/billing/BillingV2";
import { AccountUsageLoader } from "@/components/clipping/web/AccountUsage";
import { LocalTime } from "@/components/LocalTime";

import { packsOnSale, plansOnSale } from "@/lib/billing-catalog";
import { isPaidPlan } from "@/lib/pricing";
import { UI_V2 } from "@/lib/screens/flag";
import { createServerClient } from "@/lib/supabase/server";
import type { LedgerEntry } from "@/lib/types";

/**
 * This page checks neither the session nor the balance: `app/app/layout.tsx` already redirected and loaded both for the
 * shell. The Balance card below reads `/api/v1/account` on the client as before.
 *
 * RLS filters to the signed-in user, so the ledger needs no `user_id` condition.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ paid?: string; start?: string; site?: string }> }) {
  const { paid: justPaid, start, site: siteParam } = await searchParams;
  // `start=1`: a link that asks for a plan up front (the plan sheet's Billing link, older emails). The first run is free.
  const site = typeof siteParam === "string" ? siteParam.slice(0, 300) : undefined;
  const supabase = await createServerClient();

  const [{ data: profile }, { data: ledger }, plans, packs] = await Promise.all([
    supabase
      .from("profiles")
      .select("plan, creem_customer_id")
      .maybeSingle<{ plan: string; creem_customer_id: string | null }>(),
    supabase
      .from("credit_ledger")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<LedgerEntry[]>(),
    plansOnSale(),
    packsOnSale(),
  ]);

  const planId = profile?.plan ?? "free";
  const current = plans.find((plan) => plan.id === planId);
  const paid = isPaidPlan(planId);
  const planCredit = plans.find((plan) => plan.id === "starter" && plan.slug && plan.credits > 0);

  if (UI_V2) {
    return (
      <BillingV2
        planId={planId}
        paid={paid}
        plans={plans}
        packs={packs}
        planCredit={planCredit}
        ledger={ledger ?? []}
        hasPortal={Boolean(profile?.creem_customer_id)}
        justPaid={justPaid === "1"}
        start={start === "1"}
        site={site}
      />
    );
  }

  return (
    <section className="billing-view">
      <h1 className="page-title">Credits and plan</h1>
      <p className="page-sub">
        1 credit = 1 minute of source video.
        {current?.watermark ? " Free clips carry a watermark." : ""}
      </p>
      {/* Only a note: credits come from the webhook, never from this query param. */}
      {justPaid === "1" && <p className="page-sub" role="status">Payment received. Credits arrive within a minute.</p>}
      {start === "1" && !paid && (
        <p className="page-sub" role="status" data-testid="billing-start">
          Your first plan and drafts are free. Pick a plan to approve and post them.
        </p>
      )}

      <div className="acct">
        <div className="settings-card">
          <h2>Balance</h2>
          <AccountUsageLoader emphasizeCredits />
          {profile?.creem_customer_id && (
            <BillingButton path="/api/v1/billing/portal" label="Manage subscription" className="plan-cta" />
          )}
        </div>
      </div>

      <h2 className="section-label">Plans</h2>
      <div className="plan-grid">
        {/* A paid plan that cannot be bought right now is hidden: no "coming soon" (product rule). */}
        {plans.filter((plan) => plan.id === "free" || plan.slug || plan.id === planId).map((plan) => {
          const isCurrent = plan.id === planId;
          return (
            <div
              key={plan.id}
              className={plan.highlight ? "settings-card is-featured" : "settings-card"}
            >
              <h2>
                {plan.name}
                {plan.highlight && !isCurrent && <span className="plan-tag">Recommended</span>}
              </h2>
              {/* A paid plan's price comes only from its catalogue row: no row, no number (cmo-review-2 S2.7). */}
              {plan.id === "free" || plan.slug ? (
                <p className="plan-price">
                  {/* The list price is permanent, not a time-limited offer: OPUSCLIP.md §3.10. */}
                  {plan.listPrice ? <del>${plan.listPrice}</del> : null}
                  <strong>${plan.price}</strong>
                  <span>/mo</span>
                </p>
              ) : null}
              {plan.interval === "year" && plan.slug && <p className="plan-billed">Billed ${plan.billedPrice} once a year</p>}
              <ul className="acct-list">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              {isCurrent ? (
                <p className="plan-cta is-current">Current plan</p>
              ) : plan.slug && !paid ? (
                <BillingButton path="/api/v1/billing/checkout" product={plan.slug} site={site} label={start === "1" ? `Start with ${plan.name}` : "Upgrade"} />
              ) : null}
            </div>
          );
        })}
      </div>

      {paid && packs.length > 0 && (
        <>
          <h2 className="section-label">Buy credits</h2>
          <div className="plan-grid">
            {packs.map((pack) => (
              <div key={pack.slug} className="settings-card">
                <h2>{pack.credits} credits</h2>
                <p className="plan-price"><strong>${pack.price_cents / 100}</strong></p>
                <p className="plan-billed">
                  ${(pack.price_cents / 100 / pack.credits).toFixed(3)} per credit
                  {planCredit ? `. Your plan: $${(planCredit.billedPrice / planCredit.credits).toFixed(3)}` : ""}
                </p>
                <BillingButton path="/api/v1/billing/checkout" product={pack.slug} label="Buy" />
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="section-label">Credit history</h2>

      {!ledger?.length ? (
        <p className="empty-state">No transactions yet.</p>
      ) : (
        <ul className="history">
          {ledger.map((row) => (
            <li key={row.id}>
              <LocalTime iso={row.created_at} />
              <span>{row.reason}</span>
              <b className={row.delta > 0 ? "is-credit" : undefined}>
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </b>
            </li>
          ))}
        </ul>
      )}
  </section>
  );
}
