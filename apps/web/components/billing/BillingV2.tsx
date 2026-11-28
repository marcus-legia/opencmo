import { BillingButton } from "@/components/billing/BillingButton";
import { OfferCard, type OfferPlan } from "@/components/billing/OfferCard";
import { SwitchAnnual } from "@/components/billing/SwitchAnnual";
import { LocalTime } from "@/components/LocalTime";
import { PageHeader } from "@/components/today/PageHeader";
import { SettingsFrame } from "@/components/today/SettingsFrame";
import type { SellablePlan } from "@/lib/billing-catalog";
import { dollars, USUAL_WAY } from "@/components/landing/data";
import type { PlanUsage } from "@/lib/billing/usage";
import { SUPPORT_EMAIL } from "@/lib/site";
import type { LedgerEntry } from "@/lib/types";

type Pack = { slug: string; credits: number; price_cents: number };

/**
 * The payment rows in plain words. The page passes only the rows Creem's webhook wrote; their `reason` strings are set in
 * SQL (`process_creem_event`, `grant_annual_credits`). Credit counts stay hidden, as everywhere under the fair-use bar.
 */
const PAYMENT_LABEL: Record<string, string> = {
  "Plan payment": "Plan payment",
  "Annual plan monthly credits": "This month's allowance from your annual plan",
  "Credit pack purchase": "Extra pack for this month",
  Refund: "Refund",
  "Payment dispute": "Payment disputed",
};

/** "18 Dec": the reset date the way the pause message says it. */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Billing (Settings.dc.html › Billing). Prices only from the catalogue rows (no row, no number), packs only for paid
 * plans, checkout and the portal through Creem. A paid plan shows one fair-use bar (wave 2) instead of a balance: what the
 * founder reads is how much of this month is used and when it resets, not credits per click.
 */
export function BillingV2({
  planId,
  paid,
  plans,
  packs,
  ledger,
  usage,
  hasPortal,
  justPaid,
  start,
  site,
}: {
  planId: string;
  paid: boolean;
  plans: SellablePlan[];
  packs: Pack[];
  planCredit: SellablePlan | undefined;
  ledger: LedgerEntry[];
  usage: PlanUsage;
  hasPortal: boolean;
  justPaid: boolean;
  start: boolean;
  site?: string;
}) {
  const current = plans.find((plan) => plan.id === planId);
  // Only a paid monthly founder, and only while the annual row is on sale (A7).
  const annual = paid && usage.interval === "month" ? plans.find((plan) => plan.interval === "year" && plan.slug) : undefined;
  const shown = plans.filter((plan) => plan.id === "free" || plan.slug || plan.id === planId);
  const offer = (interval: "month" | "year"): OfferPlan | undefined => {
    const plan = plans.find((candidate) => candidate.interval === interval && candidate.slug);
    return plan?.slug ? { slug: plan.slug, price: plan.price, billedPrice: plan.billedPrice } : undefined;
  };
  const monthlyOffer = offer("month");
  const annualOffer = offer("year");
  // A free account sees the offer as the landing page shows it (owner, 2026-11-23) instead of the grid of plan boxes.
  const showOffer = !paid && Boolean(monthlyOffer || annualOffer);
  // Every paid plan is Pro; the catalogue rows are named by how they bill ("Monthly", "Annual").
  const planName = "Pro";
  const billing = current?.interval === "year" ? "billed yearly" : "billed monthly";
  return (
    <SettingsFrame current="billing">
      <div data-testid="v2-billing" className="uip-billing">
        <PageHeader
          title="Billing"
          status={paid ? `${planName}, ${billing}${usage.interval === "month" && usage.resetsAt ? ` · renews on ${day(usage.resetsAt)}` : ""}` : "Free plan · your first scan is free"}
        />
        {justPaid ? (
          <p className="ui-t-sm uip-flat" role="status">
            Payment received. Your plan is active within a minute.
          </p>
        ) : null}
        {start && !paid ? (
          <p className="ui-t-sm ui-muted uip-flat" role="status" data-testid="billing-start">
            Your first scan is free: the people asking, in their own words. Pick a plan to get the replies written and to approve and post your drafts.
          </p>
        ) : null}

        <section className="ui-card uip-plan" data-testid="billing-plan" aria-labelledby="billing-plan-title">
          <div className="uip-plan__now">
            <span className="ui-t-xs ui-muted">Your plan</span>
            <div className="ui-row">
              <h2 id="billing-plan-title" className="uip-plan__name">
                {paid ? planName : "Free"}
              </h2>
              {paid ? (
                <span className="ui-chip ui-chip--dot" data-tone="ok">
                  Active
                </span>
              ) : null}
            </div>
            {paid ? (
              <p className="ui-t-sm ui-muted uip-flat ui-num">
                {[
                  // A price only from its catalogue row: no row, no number (cmo-review-2 S2.7).
                  current?.slug ? (current.interval === "year" ? `$${current.billedPrice} a year` : `$${dollars(current.price)} a month`) : null,
                  usage.interval === "month" && usage.resetsAt ? `renews on ${day(usage.resetsAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : (
              <p className="ui-t-sm ui-muted uip-flat">Your first scan is free. A plan writes the replies and the week of posts.</p>
            )}
            <div className="ui-row" style={{ marginTop: "var(--sp-2)" }}>
              {!paid ? (
                <a href="#billing-plans" className="ui-btn ui-btn--primary">
                  Upgrade to Pro
                </a>
              ) : null}
              {annual ? <SwitchAnnual billed={annual.billedPrice} /> : null}
              {hasPortal ? <BillingButton path="/api/v1/billing/portal" label="Manage or cancel subscription" className="ui-btn ui-btn--ghost" /> : null}
            </div>
            <p className="ui-t-xs ui-muted uip-flat">Payments, invoices and cancelling are handled by Creem, our merchant of record.</p>
          </div>
          {paid ? (
            <div className="uip-plan__usage" data-testid="billing-usage">
              <span className="ui-t-xs ui-muted">{usage.interval === "year" ? "This month of your year" : "This month"}</span>
              <div className="ui-row" style={{ alignItems: "baseline" }}>
                <span className="uip-plan__pct ui-num">{usage.percent}%</span>
                <span className="ui-t-sm ui-muted">of the fair-use allowance used</span>
              </div>
              <div
                className="ui-meter uip-plan__meter"
                role="meter"
                aria-label="Fair-use allowance used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={usage.percent}
                data-paused={usage.paused ? "" : undefined}
              >
                <span style={{ width: `${usage.percent}%` }} />
              </div>
              {/* At 100% (wave 4 C2): what stopped and until when, what keeps working, the plans. Same lines as the banner. */}
              <p className="ui-t-xs ui-muted uip-flat" data-testid={usage.paused ? "billing-usage-full" : undefined}>
                {usage.paused
                  ? `New scans and competitor research stop until ${usage.resetsAt ? day(usage.resetsAt) : "the allowance resets"}. The people already found, your drafts and your posts keep working.`
                  : usage.resetsAt
                    ? `Resets on ${day(usage.resetsAt)}.`
                    : "Resets each month."}
              </p>
              {usage.paused ? (
                <a href="#billing-plans" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ alignSelf: "flex-start" }}>
                  See plans
                </a>
              ) : null}
            </div>
          ) : null}
        </section>

        {showOffer ? (
          <section id="billing-plans" className="up-billing" data-testid="billing-offer">
            <article aria-label="The usual way" className="up-usual">
              <h3>The usual way, by hand</h3>
              <ul>
                {USUAL_WAY.map((row) => (
                  <li key={row.who}>
                    {row.who}
                    <span>{row.cost}</span>
                  </li>
                ))}
              </ul>
              <p className="up-usual-total">Or one plan that searches, scores and drafts for you.</p>
            </article>
            <OfferCard monthly={monthlyOffer} annual={annualOffer} site={site} label={start ? "Start with Pro" : "Upgrade now"} />
          </section>
        ) : null}

        {showOffer ? null : (
          <section id="billing-plans" aria-labelledby="billing-plans-title" className="ui-stack">
            <h2 id="billing-plans-title" className="uip-h2">
              Plans
            </h2>
            <div className="uip-plans">
              {/* A paid plan that cannot be bought right now is hidden: no "coming soon" (product rule). */}
              {shown.map((plan) => {
                const isCurrent = plan.id === planId;
                // The current plan carries the mark (it was a grey line while Annual was highlighted, 28/11); "Recommended"
                // is for someone still choosing.
                const featured = !paid && plan.highlight && !isCurrent;
                return (
                  <article key={plan.id} className="ui-card uip-plancard" data-active={isCurrent ? "" : undefined} data-featured={featured ? "" : undefined} aria-current={isCurrent ? "true" : undefined}>
                    <div className="uip-plancard__head">
                      <h3>{plan.name}</h3>
                      {isCurrent ? (
                        <span className="ui-chip" data-tone="accent">
                          Current plan
                        </span>
                      ) : featured ? (
                        <span className="ui-chip">Recommended</span>
                      ) : null}
                    </div>
                    {/* A paid plan's price comes only from its catalogue row: no row, no number (cmo-review-2 S2.7). */}
                    {plan.id === "free" || plan.slug ? (
                      <p className="uip-plancard__price ui-num">
                        {plan.listPrice ? <del className="ui-muted">${dollars(plan.listPrice)}</del> : null} <b>${dollars(plan.price)}</b>
                        <span className="ui-muted"> / month</span>
                      </p>
                    ) : null}
                    {plan.interval === "year" && plan.slug ? <span className="ui-t-xs ui-muted ui-num">Billed ${plan.billedPrice} once a year</span> : null}
                    <ul className="uip-plancard__features">
                      {plan.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                    {isCurrent ? null : plan.slug && !paid ? (
                      <BillingButton path="/api/v1/billing/checkout" product={plan.slug} site={site} label={start ? `Start with ${plan.name}` : "Upgrade"} className="ui-btn ui-btn--primary" />
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {paid && packs.length > 0 ? (
          <section className="ui-stack" id="billing-packs" aria-labelledby="billing-packs-title">
            <div className="ui-row" style={{ justifyContent: "space-between" }}>
              <h2 id="billing-packs-title" className="uip-h2">
                More this month
              </h2>
              <span className="ui-t-xs ui-muted">One-time, for paid plans</span>
            </div>
            <div className="uip-plans uip-plans--sm">
              {packs.map((pack) => (
                <article key={pack.slug} className="ui-card uip-plancard">
                  <h3>{pack.credits} credits</h3>
                  <span className="ui-t-sm ui-muted ui-num">
                    ${pack.price_cents / 100} · adds {pack.credits} credits to this month&apos;s allowance
                  </span>
                  <BillingButton path="/api/v1/billing/checkout" product={pack.slug} label="Buy" className="ui-btn ui-btn--ghost" />
                </article>
              ))}
            </div>
            <p className="ui-t-xs ui-muted uip-flat">For a month with more searches than usual. A pack costs more per credit than the plan.</p>
          </section>
        ) : null}

        <section className="ui-card ui-card--flush" data-testid="billing-payments" aria-labelledby="billing-payments-title">
          <div className="ui-card__head uip-cardpad">
            <h2 id="billing-payments-title">Payments</h2>
            {hasPortal ? <span className="ui-t-xs ui-muted">Invoices are in Creem&apos;s billing page</span> : null}
          </div>
          {ledger.length === 0 ? <p className="ui-t-sm ui-muted uip-flat uip-cardbody">No payments yet.</p> : null}
          {ledger.length ? (
            <ul className="uip-ledger">
              {ledger.slice(0, 12).map((row) => (
                <li key={row.id}>
                  <span className="ui-t-xs ui-muted ui-num">
                    <LocalTime iso={row.created_at} />
                  </span>
                  <span>{PAYMENT_LABEL[row.reason] ?? "Billing update"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {paid ? (
          <section className="ui-card ui-stack" data-testid="billing-cancel" aria-labelledby="billing-cancel-title">
            <h2 id="billing-cancel-title" className="uip-h2">
              Cancel your plan
            </h2>
            {/* Creem's portal cancels at once (`subscription.canceled`, app/api/v1/billing/portal/route.ts): no "until" date to promise. */}
            <p className="ui-t-sm uip-flat">
              Cancelling ends your plan right away, and you are not charged again. Your Library, documents and drafts stay in your account if you come
              back.
            </p>
            {hasPortal ? (
              <BillingButton path="/api/v1/billing/portal" label="Cancel plan" className="ui-btn ui-btn--danger" />
            ) : (
              <p className="ui-t-sm ui-muted uip-flat">
                To cancel, write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from your account email.
              </p>
            )}
          </section>
        ) : null}

        <p className="ui-t-xs ui-muted uip-flat" data-testid="billing-support">
          Questions about a charge: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Refunds: see the <a href="/refund">refund policy</a>.
        </p>
      </div>
    </SettingsFrame>
  );
}
