import { BalanceV2 } from "@/components/billing/BalanceV2";
import { BillingButton } from "@/components/billing/BillingButton";
import { AccountUsageLoader } from "@/components/clipping/web/AccountUsage";
import { LocalTime } from "@/components/LocalTime";
import { Panel } from "@/components/ui";
import type { SellablePlan } from "@/lib/billing-catalog";
import type { LedgerEntry } from "@/lib/types";

import "@/components/screens/screens.css";

type Pack = { slug: string; credits: number; price_cents: number };

/**
 * Billing in the v2 frame (Today redesign, canvas Settings.dc.html › Billing). The same data and rules as the classic
 * page: prices only from the catalogue rows (no row, no number), packs only for paid plans, checkout and the portal
 * through Creem, the same usage rows and watermark note. Only the layout changed.
 */
export function BillingV2({
  planId,
  paid,
  plans,
  packs,
  planCredit,
  ledger,
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
  hasPortal: boolean;
  justPaid: boolean;
  start: boolean;
  site?: string;
}) {
  const current = plans.find((plan) => plan.id === planId);
  const shown = plans.filter((plan) => plan.id === "free" || plan.slug || plan.id === planId);
  return (
    <div className="v2-page scr td-billing" data-testid="v2-billing">
      <header className="scr-head td-head">
        <div className="scr-head-text">
          <span className="scr-eyebrow">
            <span className="v2-mono is-muted">Settings</span>
          </span>
          <h1 className="v2-title scr-title">Billing</h1>
          <p className="scr-head-sub">
            Every paid job shows its cost before it runs. Credits come back for work that failed or was blocked.
            {current?.watermark ? " Free clips carry a watermark." : ""}
          </p>
        </div>
      </header>
      {justPaid && (
        <p className="v2-card-state is-decided_elsewhere" role="status">
          Payment received. Credits arrive within a minute.
        </p>
      )}
      {start && !paid && (
        <p className="v2-card-state is-needs_credits" role="status" data-testid="billing-start">
          Your first plan and drafts are free. Pick a plan to approve and post them.
        </p>
      )}

      <section className="v2-panel td-billing-now">
        <div className="v2-panel-body td-billing-now-body">
          <div className="td-billing-plan">
            <span className="v2-mono is-muted">Your plan</span>
            <span className="td-billing-plan-name">
              {current?.name ?? planId}
              {paid ? <span className="v2-chip is-posted">Active</span> : null}
            </span>
            {current && (current.id === "free" || current.slug) ? (
              <span className="v2-muted">
                ${current.price} a month
              </span>
            ) : null}
            {hasPortal ? (
              <div className="v2-actions" style={{ marginTop: 10 }}>
                <BillingButton path="/api/v1/billing/portal" label="Invoices, payment method and cancelling" className="v2-button is-secondary is-compact" />
              </div>
            ) : null}
            <span className="v2-mono is-muted" style={{ marginTop: 6 }}>Payments are handled by Creem, our merchant of record.</span>
          </div>
          <div className="td-billing-balance">
            <span className="v2-mono is-muted">Credits left</span>
            <BalanceV2 />
          </div>
        </div>
      </section>

      {/* The classic page's usage rows (exports left today, held per video, when quotas reset), kept whole. */}
      <Panel id="billing-usage" title="Usage">
        <div className="v2-panel-body td-billing-usage">
          <AccountUsageLoader emphasizeCredits />
        </div>
      </Panel>

      <Panel id="billing-plans" title="Plans">
        <div className="v2-panel-body td-billing-grid">
          {/* A paid plan that cannot be bought right now is hidden: no "coming soon" (product rule). */}
          {shown.map((plan) => {
            const isCurrent = plan.id === planId;
            return (
              <div key={plan.id} className={plan.highlight ? "td-plan is-featured" : "td-plan"}>
                <div className="td-plan-top">
                  <b>{plan.name}</b>
                  {plan.highlight && !isCurrent ? <span className="v2-chip is-running">Recommended</span> : null}
                </div>
                {/* A paid plan's price comes only from its catalogue row: no row, no number (cmo-review-2 S2.7). */}
                {plan.id === "free" || plan.slug ? (
                  <p className="td-plan-price">
                    {plan.listPrice ? <del>${plan.listPrice}</del> : null}
                    <b>${plan.price}</b>
                    <span className="v2-muted"> / month</span>
                  </p>
                ) : null}
                {plan.interval === "year" && plan.slug ? <p className="v2-mono is-muted">Billed ${plan.billedPrice} once a year</p> : null}
                <ul className="td-plan-list">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {isCurrent ? (
                  <span className="v2-mono is-muted">Current plan</span>
                ) : plan.slug && !paid ? (
                  <BillingButton
                    path="/api/v1/billing/checkout"
                    product={plan.slug}
                    site={site}
                    label={start ? `Start with ${plan.name}` : "Upgrade"}
                    className="v2-button is-primary"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </Panel>

      {paid && packs.length > 0 ? (
        <Panel id="billing-packs" title="Credit packs">
          <div className="v2-panel-body td-billing-grid">
            {packs.map((pack) => (
              <div key={pack.slug} className="td-plan">
                <b>{pack.credits} credits</b>
                <p className="td-plan-price">
                  <b>${pack.price_cents / 100}</b>
                </p>
                <p className="v2-mono is-muted">
                  ${(pack.price_cents / 100 / pack.credits).toFixed(3)} per credit
                  {planCredit ? `. Your plan: $${(planCredit.billedPrice / planCredit.credits).toFixed(3)}` : ""}
                </p>
                <BillingButton path="/api/v1/billing/checkout" product={pack.slug} label="Buy" className="v2-button is-secondary" />
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel id="billing-history" title="Credit history">
        {ledger.length === 0 ? (
          <p className="v2-panel-body v2-muted">No transactions yet.</p>
        ) : (
          <ul className="td-ledger">
            {ledger.map((row) => (
              <li key={row.id}>
                <span className="v2-mono is-muted">
                  <LocalTime iso={row.created_at} />
                </span>
                <span className="td-ledger-reason">{row.reason}</span>
                <b className={row.delta > 0 ? "v2-num v2-ok-text" : "v2-num"}>{row.delta > 0 ? `+${row.delta}` : row.delta}</b>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
