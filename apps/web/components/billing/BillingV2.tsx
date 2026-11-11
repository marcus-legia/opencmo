import Link from "next/link";

import { BalanceV2 } from "@/components/billing/BalanceV2";
import { BillingButton } from "@/components/billing/BillingButton";
import { AccountUsageLoader } from "@/components/clipping/web/AccountUsage";
import { LocalTime } from "@/components/LocalTime";
import { SettingsFrame } from "@/components/today/SettingsFrame";
import type { SellablePlan } from "@/lib/billing-catalog";
import type { LedgerEntry } from "@/lib/types";

type Pack = { slug: string; credits: number; price_cents: number };

/**
 * Billing (Settings.dc.html › Billing). The same data and rules as the classic page: prices only from the catalogue rows
 * (no row, no number), packs only for paid plans, checkout and the portal through Creem, the usage rows and the
 * watermark note. Only the layout is the artboard's.
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
  const spentThisMonth = ledger.filter((r) => r.delta < 0 && new Date(r.created_at).getMonth() === new Date().getMonth()).reduce((sum, r) => sum - r.delta, 0);
  return (
    <SettingsFrame current="billing">
      <div data-testid="v2-billing" style={{ display: "contents" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: "600", letterSpacing: "-0.4px" }}>Billing</h1>
        {justPaid ? (
          <p className="meta" role="status">
            Payment received. Credits arrive within a minute.
          </p>
        ) : null}
        {start && !paid ? (
          <p className="meta" role="status" data-testid="billing-start">
            Your first plan and drafts are free. Pick a plan to approve and post them.
          </p>
        ) : null}

        <section className="card">
          <div className="bd" style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 260px" }}>
              <div className="meta" style={{ marginBottom: "6px" }}>
                Your plan
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <span style={{ fontSize: "20px", fontWeight: "600" }}>{current?.name ?? planId}</span>
                {paid ? <span className="badge">Active</span> : null}
              </div>
              {current && (current.id === "free" || current.slug) ? (
                <div style={{ marginTop: "6px", color: "var(--muted)" }}>
                  ${current.price} a month
                  {current.watermark ? " · free clips carry a watermark" : ""}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
                <a href="#billing-plans" className="ghost" style={{ textDecoration: "none" }}>
                  Change plan
                </a>
                {hasPortal ? <BillingButton path="/api/v1/billing/portal" label="Invoices and payment method" className="ghost" /> : null}
              </div>
              <div className="meta" style={{ marginTop: "8px" }}>
                Payments, invoices and cancelling are handled by Creem, our merchant of record.
              </div>
            </div>
            <div style={{ flex: "0 1 220px", borderLeft: "1px solid var(--line)", paddingLeft: "24px" }}>
              <div className="meta" style={{ marginBottom: "6px" }}>
                Credits left
              </div>
              <div style={{ fontSize: "32px", fontWeight: "600", letterSpacing: "-0.8px", lineHeight: "1" }}>
                <BalanceV2 />
              </div>
              {paid && packs.length ? (
                <a href="#billing-packs" className="ghost" style={{ marginTop: "12px", textDecoration: "none" }}>
                  Buy credits
                </a>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="hd">
            <h2>Spent this month</h2>
            <span className="meta">{spentThisMonth} credits</span>
            <div style={{ flex: "1 1 auto" }}></div>
            <Link href="/app?logs=1" style={{ fontSize: "13px", textDecoration: "none" }}>
              Open Logs
            </Link>
          </div>
          <div className="bd td-v2host">
            {/* The classic page's usage rows (held per video, exports left today, when quotas reset). The balance is the
                "Credits left" above: shown again here, unlabelled under "Spent this month", it read as what was spent. */}
            <AccountUsageLoader hideCredits />
          </div>
        </section>

        <section className="card" id="billing-plans">
          <div className="hd">
            <h2>Plans</h2>
          </div>
          <div className="bd">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "10px" }}>
              {/* A paid plan that cannot be bought right now is hidden: no "coming soon" (product rule). */}
              {shown.map((plan) => {
                const isCurrent = plan.id === planId;
                return (
                  <div key={plan.id} className="pack" style={plan.highlight ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : undefined}>
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
                      <span style={{ fontWeight: "600" }}>{plan.name}</span>
                      {plan.highlight && !isCurrent ? <span className="badge">Recommended</span> : null}
                    </span>
                    {/* A paid plan's price comes only from its catalogue row: no row, no number (cmo-review-2 S2.7). */}
                    {plan.id === "free" || plan.slug ? (
                      <span>
                        {plan.listPrice ? <del className="meta">${plan.listPrice}</del> : null} <b style={{ fontSize: "20px" }}>${plan.price}</b>
                        <span className="meta"> / month</span>
                      </span>
                    ) : null}
                    {plan.interval === "year" && plan.slug ? <span className="meta">Billed ${plan.billedPrice} once a year</span> : null}
                    <ul style={{ margin: "0", paddingLeft: "18px", fontSize: "13.5px", lineHeight: "1.6", color: "var(--muted)" }}>
                      {plan.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                    {isCurrent ? (
                      <span className="meta">Current plan</span>
                    ) : plan.slug && !paid ? (
                      <BillingButton path="/api/v1/billing/checkout" product={plan.slug} site={site} label={start ? `Start with ${plan.name}` : "Upgrade"} className="primary" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {paid && packs.length > 0 ? (
          <section className="card" id="billing-packs">
            <div className="hd">
              <h2>Credit packs</h2>
              <span className="meta">one-time, for paid plans</span>
            </div>
            <div className="bd">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "10px" }}>
                {packs.map((pack) => (
                  <div key={pack.slug} className="pack">
                    <span style={{ fontWeight: "600" }}>{pack.credits} credits</span>
                    <span className="meta">
                      ${pack.price_cents / 100} · ${(pack.price_cents / 100 / pack.credits).toFixed(3)} per credit
                      {planCredit ? `. Your plan: $${(planCredit.billedPrice / planCredit.credits).toFixed(3)}` : ""}
                    </span>
                    <BillingButton path="/api/v1/billing/checkout" product={pack.slug} label="Buy" className="ghost" />
                  </div>
                ))}
              </div>
              <div className="meta" style={{ marginTop: "10px" }}>
                A pack credit costs more than a plan credit; upgrading is the cheaper way to get more each month.
              </div>
            </div>
          </section>
        ) : null}

        <section className="card">
          <div className="hd">
            <h2>Recent payments and credits</h2>
          </div>
          {ledger.length === 0 ? <div className="row meta">No transactions yet.</div> : null}
          {ledger.slice(0, 12).map((row) => (
            <div key={row.id} className="row">
              <span className="mono meta" style={{ width: "120px" }}>
                <LocalTime iso={row.created_at} />
              </span>
              <span style={{ flex: "1" }}>{row.reason}</span>
              <span className="mono" style={{ textAlign: "right", color: row.delta > 0 ? "var(--ok)" : undefined }}>
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </span>
            </div>
          ))}
        </section>
      </div>
    </SettingsFrame>
  );
}
