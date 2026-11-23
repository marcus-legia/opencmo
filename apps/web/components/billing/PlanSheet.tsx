"use client";

import { useEffect, useRef, useState } from "react";

import { OfferCard } from "@/components/billing/OfferCard";
import { api } from "@/components/clipping/api";
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

/**
 * The one answer to a 402 `plan_required` (CMO review 3, plan §3.1; canvas Plans board). The first run is free; approving,
 * posting, the chat, Sales and planning again need a plan. The founder's drafts stay where they are. Prices come from
 * the catalogue (`/api/v1/billing/plans`), never from code. The offer is the landing page's pricing card (`OfferCard`,
 * owner 2026-11-23), so the sheet and the landing never disagree. The allowance is fair use, so no credit count is shown.
 *
 * `action` is what the founder tried, in a few words, for the title ("approve and post", "reply to these people").
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

  const monthly = plans?.find((plan) => plan.interval === "month");
  const annual = plans?.find((plan) => plan.interval === "year");

  return (
    <dialog
      ref={ref}
      className="v2-dialog plan-sheet up-sheet"
      aria-labelledby="plan-sheet-title"
      data-testid="plan-sheet"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="up-sheet-top">
        <div>
          <h2 id="plan-sheet-title">Pick a plan to {action}</h2>
          <p>One plan. Everything included.</p>
        </div>
        <button type="button" className="up-sheet-close" aria-label="Not now" onClick={() => ref.current?.close()}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {plans === null && !failed ? <p className="up-sheet-note">Loading plans…</p> : null}
      {failed ? (
        <p className="up-sheet-note" role="alert">
          The plans could not be loaded. Try again in a moment, or <a href="/app/billing">open Billing</a>.
        </p>
      ) : null}
      {/* No catalogue row: say so and offer nothing to click. */}
      {plans && !monthly && !annual ? (
        <p className="up-sheet-note" data-testid="plan-sheet-closed">
          Plans can&apos;t be bought yet. What you have here stays. Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will tell
          you when they can.
        </p>
      ) : null}
      {monthly || annual ? <OfferCard monthly={monthly} annual={annual} label="Upgrade now" testId={(slug) => `plan-sheet-${slug}`} /> : null}
    </dialog>
  );
}
