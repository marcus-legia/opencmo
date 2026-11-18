"use client";

import { useEffect, useRef } from "react";

import { BEATS, BRAND } from "./data";
import { gsap, prefersReducedMotion } from "./motion";
import { ScrollEssay } from "./ScrollEssay";

/**
 * Centred hero (eyebrow, headline, one line on what it does, website form), then the story I–IV as one large
 * statement whose words darken as the reader scrolls. The H1 and the form are in the HTML from the start (SEO, and
 * starting needs no JavaScript).
 */
export function Hero({ action }: { action: string }) {
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from("[data-intro-line]", { yPercent: 110, duration: 1.5, ease: "expo.out", stagger: 0.1, delay: 0.2 });
      gsap.from("[data-intro]", { y: 24, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.08, delay: 0.5 });
    }, heroRef.current!);
    return () => ctx.revert();
  }, []);

  return (
    <>
      <section id="top" ref={heroRef} className="lv-hero">
        <p data-intro="1" className="lv-eyebrow">For founders who sell software to businesses</p>
        <h1 className="lv-hero-title is-long">
          <span className="lv-mask"><span data-intro-line="1">Find the people</span></span>
          <span className="lv-mask"><span data-intro-line="1">already asking for</span></span>
          <span className="lv-mask"><span data-intro-line="1">what you built<span aria-hidden="true" className="lv-dot" /></span></span>
        </h1>
        <p data-intro="1" className="lv-hero-sub">
          {BRAND} reads your website, then searches Reddit, Hacker News, Threads and Facebook groups for people describing
          the problem you solve. Each one comes with the quote that shows why, and a draft reply based on your business
          plan. You post it from your own account.
        </p>
        {/* `site` travels through login (LoginForm → auth/callback) into the app. */}
        <form data-intro="1" action={action} className="lv-pill-form">
          <label htmlFor="hero-site" className="sr-only">Your website</label>
          <input id="hero-site" name="site" type="text" inputMode="url" autoComplete="url" required placeholder="yourcompany.com" />
          <button type="submit" className="lv-btn-terra">See who&apos;s asking</button>
        </form>
      </section>

      <ScrollEssay beats={BEATS} label="How it works" />
    </>
  );
}
