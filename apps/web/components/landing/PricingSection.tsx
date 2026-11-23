"use client";

import { useState } from "react";

import { BRAND, dollars, INCLUDED, savePercent, USUAL_WAY, type Prices } from "./data";
import { LineIcon, LogoMark } from "./Glyphs";

/**
 * One price, billed annually by default. The usual way (time and tools, estimates footnoted below) sits next to the
 * offer. Deliberately NOT animated: this part has to read at a glance. On phones the offer comes first.
 */
export function PricingSection({ prices, action }: { prices: Prices; action: string }) {
  const [annual, setAnnual] = useState(true);
  const price = annual ? prices.annual : prices.monthly;
  const save = savePercent(prices);

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="lv-panel-section is-pricing">
      <div className="lv-container lv-stack-40">
        <div className="lv-pricing-head">
          <div className="lv-stack-16">
            <p className="lv-eyebrow">Pricing</p>
            <h2 id="pricing-title" className="lv-h2 is-lg">One plan. <span className="lv-accent">Everything included.</span></h2>
            <p className="lv-lede is-wide">The searches, the reply ideas, the drafted DMs and emails and the weekly posts, for one price.</p>
          </div>
          <div role="radiogroup" aria-label="Billing" className="lv-segment is-billing">
            <button type="button" role="radio" aria-checked={!annual} className={annual ? "" : "is-on"} onClick={() => setAnnual(false)}>Monthly</button>
            <button type="button" role="radio" aria-checked={annual} className={`is-annual ${annual ? "is-on" : ""}`} onClick={() => setAnnual(true)}>
              Annual<span className="lv-save">Save {save}%</span>
            </button>
          </div>
        </div>

        <div className="lv-pricing-grid">
          <article aria-label="The usual way" className="lv-usual">
            <div className="lv-usual-head"><h3>The usual way, by hand</h3></div>
            <ul>
              {USUAL_WAY.map((r) => (
                <li key={r.who}><b>{r.who}</b><span className="is-text">{r.cost}</span></li>
              ))}
            </ul>
          </article>

          <article aria-label={BRAND} className="lv-offer">
            <div className="lv-offer-head">
              <h3><LogoMark size={24} />{BRAND}</h3>
            </div>
            <div className="lv-offer-price">
              <p>
                {annual && <s>${dollars(prices.monthly)}</s>}
                <strong>${dollars(price)}</strong>
                <span>/ month</span>
              </p>
              <span>{annual ? `Billed $${prices.annualBilled} once a year` : `Billed monthly · switch to annual to save ${save}%`}</span>
            </div>
            <ul className="lv-included">
              {INCLUDED.map((f) => (
                <li key={f.title}>
                  <span className="lv-included-icon"><LineIcon d={f.icon} size={15} width={2} /></span>
                  <span><b>{f.title}</b><small>{f.body}</small></span>
                </li>
              ))}
            </ul>
            <div className="lv-offer-zone">
              <span>See who is asking for your product</span>
              <form action={action} className="lv-pill-form is-dark">
                <label htmlFor="price-site" className="sr-only">Your website</label>
                <input id="price-site" name="site" type="text" inputMode="url" autoComplete="url" required placeholder="yourcompany.com" />
                <button type="submit" className="lv-btn-terra">See who&apos;s asking</button>
              </form>
              <small>Run one scan free and see who is asking for your product before you pay. Cancel anytime.</small>
            </div>
          </article>
        </div>
        <p className="lv-fineprint">The usual-way figures are typical 2026 time and tool costs for one founder doing this by hand. They are estimates, not quotes.</p>
      </div>
    </section>
  );
}
