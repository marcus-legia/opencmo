"use client";

import { useEffect, useRef, useState } from "react";

import { BillingButton } from "@/components/billing/BillingButton";
import { api } from "@/components/clipping/api";
import { dollars, INCLUDED, savePercent } from "@/components/landing/data";
import type { PlanOffer } from "@/lib/plan-offer";
import { SUPPORT_EMAIL } from "@/lib/site";

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

function billedNote(plan: PlanOffer): string {
  return plan.interval === "year" ? `$${plan.billedPrice} billed once a year` : "Billed every month";
}

/**
 * The one answer to a 402 `plan_required` (CMO review 3, plan §3.1; canvas Plans board). The first run is free; approving,
 * posting, the chat, Sales and planning again need a plan. The founder's drafts stay where they are. Prices come from
 * the catalogue (`/api/v1/billing/plans`), never from code; the saving is worked out from those two prices and the
 * included lines are the landing page's, so the sheet and the landing never disagree. The allowance is fair use, so
 * no credit count is shown.
 *
 * `action` is what the founder tried, in a few words, for the title ("approve and post", "reply to these people").
 */
export function PlanSheet({ open, onClose, action = "approve and post" }: { open: boolean; onClose: () => void; action?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [plans, setPlans] = useState<PlanOffer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

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

  const monthly = plans?.find((plan) => plan.interval === "month");
  const annual = plans?.find((plan) => plan.interval === "year");
  const save = monthly && annual && monthly.price > 0 ? savePercent({ monthly: monthly.price, annual: annual.price, annualBilled: annual.billedPrice }) : 0;
  const options = [monthly, annual].filter((plan): plan is PlanOffer => Boolean(plan));
  // Annual is picked first, as on the landing page.
  const chosen = options.find((plan) => plan.slug === picked) ?? annual ?? monthly;

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
        <div>
          <h2 id="plan-sheet-title" className="v2-dialog-title">
            Pick a plan to {action}
          </h2>
          <p className="v2-muted plan-sheet-sub">One plan. Everything included.</p>
        </div>
        {plans === null && !failed ? <p className="v2-mono is-muted">Loading plans…</p> : null}
        {failed ? (
          <p className="v2-muted" role="alert">
            The plans could not be loaded. Try again in a moment, or <a href="/app/billing">open Billing</a>.
          </p>
        ) : null}
        {/* No catalogue row (production, until Creem approves the store): say so and offer nothing to click. */}
        {plans && options.length === 0 ? (
          <p className="v2-muted" data-testid="plan-sheet-closed">
            Plans can&apos;t be bought yet. What you have here stays. Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will
            tell you when they can.
          </p>
        ) : null}
        {chosen ? (
          <>
            <div role="radiogroup" aria-label="Billing" className="plan-sheet-options">
              {options.map((plan) => {
                const on = plan.slug === chosen.slug;
                return (
                  <button
                    key={plan.slug}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={on ? "td-plan is-featured" : "td-plan"}
                    data-testid={`plan-sheet-${plan.slug}`}
                    onClick={() => setPicked(plan.slug)}
                  >
                    <span className="td-plan-top">
                      <b>{plan.name}</b>
                      {plan.interval === "year" && save > 0 ? <span className="v2-chip is-running">Save {save}%</span> : null}
                    </span>
                    <span className="td-plan-price">
                      <b>${dollars(plan.price)}</b>
                      <span className="v2-muted"> / month</span>
                    </span>
                    <span className="v2-mono is-muted">{billedNote(plan)}</span>
                  </button>
                );
              })}
            </div>
            <ul className="plan-sheet-included">
              {INCLUDED.map((line) => (
                <li key={line.title}>
                  <span aria-hidden="true" className="plan-sheet-check">
                    ✓
                  </span>
                  <span>
                    <b>{line.title}.</b> <span className="v2-muted">{line.body}.</span>
                  </span>
                </li>
              ))}
            </ul>
            <BillingButton path="/api/v1/billing/checkout" product={chosen.slug} label="Continue to checkout" className="v2-button is-primary" />
            <p className="v2-muted plan-sheet-fine">
              Secure checkout by Creem, our payment provider. Cancel anytime in Settings. Replies are never posted for you.
            </p>
          </>
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
