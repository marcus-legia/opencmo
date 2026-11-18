import { BillingButton } from "@/components/billing/BillingButton";
import { LocalTime } from "@/components/LocalTime";
import { SettingsFrame } from "@/components/today/SettingsFrame";
import type { SellablePlan } from "@/lib/billing-catalog";
import type { PlanUsage } from "@/lib/billing/usage";
import type { LedgerEntry } from "@/lib/types";

type Pack = { slug: string; credits: number; price_cents: number };

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
  planCredit,
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
  const shown = plans.filter((plan) => plan.id === "free" || plan.slug || plan.id === planId);
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
            Your first scan is free: the people asking, in their own words. Pick a plan to get the replies written and to approve and post your drafts.
          </p>
        ) : null}

        <section className="card" data-testid="billing-plan">
          <div className="bd" style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 260px" }}>
              <div className="meta" style={{ marginBottom: "6px" }}>
                Your plan
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <span style={{ fontSize: "20px", fontWeight: "600" }}>{paid ? "Pro" : "Free"}</span>
                {paid ? <span className="badge">Active</span> : null}
              </div>
              {paid ? (
                <div style={{ marginTop: "6px", color: "var(--muted)" }}>
                  {[
                    // A price only from its catalogue row: no row, no number (cmo-review-2 S2.7).
                    current?.slug ? (current.interval === "year" ? `$${current.billedPrice} a year` : `$${current.price} a month`) : null,
                    usage.interval === "month" && usage.resetsAt ? `renews on ${day(usage.resetsAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              ) : null}
              {!paid ? (
                <div style={{ marginTop: "6px", color: "var(--muted)" }}>Your first scan is free. A plan writes the replies and the week of posts.</div>
              ) : null}
              <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
                {!paid ? (
                  <a href="#billing-plans" className="ghost" style={{ textDecoration: "none" }}>
                    See plans
                  </a>
                ) : null}
                {hasPortal ? <BillingButton path="/api/v1/billing/portal" label="Invoices and payment method" className="ghost" /> : null}
                {paid && hasPortal ? <BillingButton path="/api/v1/billing/portal" label="Cancel plan" className="ghost" /> : null}
              </div>
              <div className="meta" style={{ marginTop: "8px" }}>
                Payments, invoices and cancelling are handled by Creem, our merchant of record.
              </div>
            </div>
            {paid ? (
              <div className="td-usage-panel" data-testid="billing-usage">
                <div className="meta" style={{ marginBottom: "6px" }}>
                  {usage.interval === "year" ? "This month of your year" : "This month"}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "32px", fontWeight: "600", letterSpacing: "-0.8px", lineHeight: "1" }}>{usage.percent}%</span>
                  <span className="meta">of the fair-use allowance used</span>
                </div>
                <div
                  className="td-usage-bar"
                  role="meter"
                  aria-label="Fair-use allowance used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={usage.percent}
                  data-paused={usage.paused ? "" : undefined}
                >
                  <span style={{ width: `${usage.percent}%` }} />
                </div>
                <div className="meta" style={{ marginTop: "8px" }}>
                  {usage.paused
                    ? `New scans pause until ${usage.resetsAt ? day(usage.resetsAt) : "the allowance resets"}. Your drafts and posts keep working.`
                    : usage.resetsAt
                      ? `Resets on ${day(usage.resetsAt)}.`
                      : "Resets each month."}
                </div>
              </div>
            ) : null}
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
