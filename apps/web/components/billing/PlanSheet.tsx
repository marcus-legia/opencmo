"use client";

import { useEffect, useRef, useState } from "react";

import { BillingButton } from "@/components/billing/BillingButton";
import { api } from "@/components/clipping/api";
import type { PlanOffer } from "@/lib/plan-offer";

export { isPlanRequired, PLAN_REQUIRED } from "@/lib/plan-offer";

let cachedPlans: Promise<PlanOffer[]> | null = null;

function loadPlans(): Promise<PlanOffer[]> {
  cachedPlans ??= api<{ plans: PlanOffer[] }>("/billing/plans")
    .then((response) => response.plans)
    .catch((error: unknown) => {
      cachedPlans = null;
      throw error;
    });
  return cachedPlans;
}

/**
 * The one answer to a 402 `plan_required` (CMO review 3, plan §3.1). The first run is free; approving, posting, the
 * chat, Sales and planning again need a plan. The founder's drafts stay where they are. Plans and prices come from the
 * catalogue (`/api/v1/billing/plans`), never from code.
 *
 * `action` is what the founder tried, in a few words, for the title ("approve and post", "scan Reddit").
 */
export function PlanSheet({ open, onClose, action = "approve and post" }: { open: boolean; onClose: () => void; action?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [plans, setPlans] = useState<PlanOffer[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || plans) return;
    let live = true;
    setFailed(false);
    loadPlans()
      .then((loaded) => {
        if (live) setPlans(loaded);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open, plans]);

  // Not in the page while closed: a closed dialog still lends its title to label lookups (screen readers, tests).
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className="v2-dialog plan-sheet"
      aria-labelledby="plan-sheet-title"
      data-testid="plan-sheet"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="v2-dialog-body">
        <h2 id="plan-sheet-title" className="v2-dialog-title">
          Pick a plan to {action}
        </h2>
        <p className="v2-muted">Your first plan and drafts were free, and they stay here. With a plan, your CMO posts them and keeps going.</p>
        {plans === null && !failed ? <p className="v2-mono is-muted">Loading plans…</p> : null}
        {failed || (plans && plans.length === 0) ? (
          <p className="v2-muted">
            The plans could not be loaded here. <a href="/app/billing">Open Billing</a>.
          </p>
        ) : null}
        {plans && plans.length > 0 ? (
          <ul className="plan-sheet-list">
            {plans.map((plan) => (
              <li key={plan.slug} className={plan.highlight ? "td-plan is-featured" : "td-plan"} data-testid={`plan-sheet-${plan.slug}`}>
                <div className="td-plan-top">
                  <b>{plan.name}</b>
                  {plan.highlight ? <span className="v2-chip is-running">Recommended</span> : null}
                </div>
                <p className="td-plan-price">
                  {plan.listPrice ? <del>${plan.listPrice}</del> : null}
                  <b>${plan.price}</b>
                  <span className="v2-muted"> / month</span>
                </p>
                <p className="v2-mono is-muted">
                  {plan.credits} credits a month{plan.interval === "year" ? `, billed $${plan.billedPrice} once a year` : ""}
                </p>
                <BillingButton
                  path="/api/v1/billing/checkout"
                  product={plan.slug}
                  label={`Pick ${plan.name}`}
                  className={plan.highlight ? "v2-button is-primary" : "v2-button is-secondary"}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="v2-actions">
          <button type="button" className="v2-button is-quiet" onClick={() => ref.current?.close()}>
            Not now
          </button>
        </div>
      </div>
    </dialog>
  );
}
