"use client";

import { useState } from "react";

import { BillingButton } from "@/components/billing/BillingButton";
import { dollars, INCLUDED, savePercent } from "@/components/landing/data";
import { LineIcon, LogoMark } from "@/components/landing/Glyphs";

export type OfferPlan = { slug: string; price: number; billedPrice: number };

/**
 * The plan as the landing page's pricing shows it (owner, 2026-11-23: "the paywall should catch the eye like the
 * landing's pricing"): the brand-orange card, Monthly / Annual, the big price, what is included and one white button.
 * Used by the plan sheet (a 402) and by Billing for a free account. Prices come from the catalogue rows passed in.
 */
export function OfferCard({
  monthly,
  annual,
  site,
  label = "Upgrade now",
  testId,
}: {
  monthly?: OfferPlan;
  annual?: OfferPlan;
  site?: string;
  label?: string;
  /** Test id for each Monthly / Annual option, from its slug. */
  testId?: (slug: string) => string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const options = [monthly, annual].filter((plan): plan is OfferPlan => Boolean(plan));
  // Annual first, as on the landing page.
  const chosen = options.find((plan) => plan.slug === picked) ?? annual ?? monthly;
  if (!chosen) return null;
  const isAnnual = chosen === annual;
  const save = monthly && annual && monthly.price > 0 ? savePercent({ monthly: monthly.price, annual: annual.price, annualBilled: annual.billedPrice }) : 0;

  return (
    <article className="up-offer" aria-label="Ferreto Pro" data-testid="offer-card">
      <div className="up-offer-head">
        <h3>
          <LogoMark size={22} />
          Ferreto <span className="up-offer-pro">Pro</span>
        </h3>
        {options.length > 1 ? (
          <div role="radiogroup" aria-label="Billing" className="up-segment">
            {options.map((plan) => {
              const on = plan.slug === chosen.slug;
              const yearly = plan === annual;
              return (
                <button key={plan.slug} type="button" role="radio" aria-checked={on} className={on ? "is-on" : ""} data-testid={testId?.(plan.slug)} onClick={() => setPicked(plan.slug)}>
                  {yearly ? "Annual" : "Monthly"}
                  {yearly && save > 0 ? <span className="up-save">-{save}%</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="up-offer-price">
        <p>
          {isAnnual && monthly ? <s>${dollars(monthly.price)}</s> : null}
          <strong>${dollars(chosen.price)}</strong>
          <span>/ month</span>
        </p>
        <span>{isAnnual ? `Billed $${chosen.billedPrice} once a year` : save > 0 ? `Billed monthly · annual saves ${save}%` : "Billed monthly"}</span>
      </div>
      <ul className="up-included">
        {INCLUDED.map((line) => (
          <li key={line.title}>
            <span className="up-included-icon" aria-hidden="true">
              <LineIcon d={line.icon} size={15} width={2} color="currentColor" />
            </span>
            <span>
              <b>{line.title}</b>
              <small>{line.body}</small>
            </span>
          </li>
        ))}
      </ul>
      <div className="up-cta-zone">
        <BillingButton path="/api/v1/billing/checkout" product={chosen.slug} site={site} label={`${label} →`} className="up-cta" />
        <small>Secure checkout by Creem. Cancel anytime, full refund within 7 days. Nothing is ever posted for you.</small>
      </div>
    </article>
  );
}
