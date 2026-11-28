"use client";

import { useState } from "react";

import { PlanSheet } from "@/components/billing/PlanSheet";

import { PlatformLogo, type LogoPlatform } from "./platform-logos";

/**
 * What a day of posts looks like, for an account without a plan (owner 2026-11-26). A free account cannot connect a
 * posting account (Zernio bills each one by the day, 20270206060000), and posts are written only for connected
 * platforms (20270206040000), so the Post page would otherwise stay empty and never show what the product does.
 *
 * The posts are fixed text written for a made-up product, not a model call: a demo for every signup that called the
 * model would be a cost with no revenue behind it. The card says plainly that they are samples, so nothing here reads as
 * a promise about the founder's own posts.
 */
const SAMPLES: { platform: LogoPlatform; name: string; text: string }[] = [
  {
    platform: "x",
    name: "X",
    text: "Three freelancers told us the same thing this week: they send the invoice, then spend a week chasing it.\n\nSo reminders now go out on day 3, 7 and 14, from your own email. You stop being the one who has to ask.",
  },
  {
    platform: "threads",
    name: "Threads",
    text: "Honest question for freelancers: how many days does a client usually take to pay you?\n\nWe asked 40 people. The answer was 23 days on average, and most of that wait was nobody following up.",
  },
  {
    platform: "linkedin",
    name: "LinkedIn",
    text: "Late payments are rarely about money. They are about nobody owning the follow-up.\n\nWe watched 40 freelancers handle unpaid invoices. The ones paid fastest did one thing the same way: a short, friendly reminder on a fixed schedule.\n\nThat is the habit we built the product around.",
  },
];

export function SamplePosts() {
  const [plans, setPlans] = useState(false);
  return (
    <section className="ui-card ps" data-testid="sample-posts" aria-labelledby="sample-posts-title">
      <div className="ps-head">
        <div>
          <h2 id="sample-posts-title">What your posts look like</h2>
          <p className="ui-t-sm ui-muted">
            Samples for a made-up invoicing app, not posts about your product. With a plan, Ferreto writes yours from your
            site and what people said in your scans, for the platforms you connect, and you approve each one.
          </p>
        </div>
        <button type="button" className="ui-btn ui-btn--primary" onClick={() => setPlans(true)}>
          See plans
        </button>
      </div>
      <div className="ps-grid">
        {SAMPLES.map((s) => (
          <article key={s.platform} data-platform={s.platform} className="ps-post">
            <div className="ps-post__head">
              <PlatformLogo platform={s.platform} size={22} />
              <b>{s.name}</b>
              <span className="ui-chip">Sample</span>
            </div>
            <p>{s.text}</p>
          </article>
        ))}
      </div>
      <PlanSheet open={plans} onClose={() => setPlans(false)} action="get posts written for you" />
    </section>
  );
}
