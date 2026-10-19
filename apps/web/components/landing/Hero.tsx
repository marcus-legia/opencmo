"use client";

import { useEffect, useRef } from "react";

import { BEATS, DEPTS } from "./data";
import { SOCIAL } from "./icons";
import { gsap, prefersReducedMotion, ScrollTrigger } from "./motion";

/** Every platform a department works on, once each, in the order the departments list them. */
const PLATFORMS = Array.from(new Set(DEPTS.flatMap((d) => d.channels))).map((k) => SOCIAL[k].name);

// A 4×2 block of brand squares with cut-outs, pinned to the hero's bottom-right corner.
const BLOCKS = ["fill", "dot", "cut", "fill", "cut", "fill", "ring", "dot"] as const;

function words(text: string) {
  return text.split(" ").map((w, i) => <span key={i} className="lv-w">{w} </span>);
}

/**
 * Hero, then the three beats I · II · III as one large statement whose words darken as
 * the reader scrolls through it. The H1 and the website form are in the HTML from the
 * start (SEO, and starting needs no JavaScript); without JS or with reduced motion the
 * statement simply renders in full ink.
 */
export function Hero({ action, fineprint }: { action: string; fineprint: string }) {
  const heroRef = useRef<HTMLElement>(null);
  const essayRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const essay = essayRef.current!;
    essay.dataset.armed = "1";
    const ctx = gsap.context(() => {
      gsap.from("[data-intro-line]", { yPercent: 110, duration: 1.5, ease: "expo.out", stagger: 0.1, delay: 0.2 });
      gsap.from("[data-intro]", { y: 24, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.08, delay: 0.5 });
      gsap.from("[data-block]", { scale: 0, duration: 0.5, ease: "expo.out", stagger: { each: 0.05, from: "random" }, delay: 0.7 });
      // GSAP cannot tween `var()`, so resolve the two target inks once.
      const css = getComputedStyle(essay);
      const ink = css.getPropertyValue("--ink").trim(), ink2 = css.getPropertyValue("--ink2").trim();
      gsap.to(essay.querySelectorAll(".lv-w"), {
        color: (_: number, el: Element) => (el.closest(".lv-essay-body") ? ink2 : ink),
        ease: "none",
        stagger: 0.1,
        scrollTrigger: { trigger: essay, start: "top 70%", end: "bottom 55%", scrub: 1.5 },
      });
    }, heroRef.current!.parentElement!);
    const refresh = setTimeout(() => ScrollTrigger.refresh(), 600);
    return () => {
      clearTimeout(refresh);
      ctx.revert();
      delete essay.dataset.armed;
    };
  }, []);

  return (
    <>
      <section id="top" ref={heroRef} className="lv-hero">
        <div className="lv-hero-inner">
          <p data-intro="1" className="lv-eyebrow">Led by an AI CMO · for founders</p>
          <h1 className="lv-hero-title">
            <span className="lv-mask"><span data-intro-line="1">Your AI</span></span>
            <span className="lv-mask"><span data-intro-line="1">marketing team<span aria-hidden="true" className="lv-dot" /></span></span>
          </h1>
          <div className="lv-hero-support">
            <p data-intro="1" className="lv-hero-lede">It edits the videos, writes the posts and finds the conversations. You approve.</p>
            {/* `site` travels through login (LoginForm → auth/callback) into the app. */}
            <form data-intro="1" action={action} className="lv-pill-form">
              <label htmlFor="hero-site" className="sr-only">Your website</label>
              <input id="hero-site" name="site" type="text" inputMode="url" autoComplete="url" required placeholder="yourcompany.com" />
              <button type="submit" className="lv-btn-terra">Start with your website</button>
            </form>
            <p data-intro="1" className="lv-hero-fine">{fineprint}</p>
          </div>
        </div>
        <div aria-hidden="true" className="lv-blocks">
          {BLOCKS.map((b, i) => <span key={i} data-block="1" className={`is-${b}`} />)}
        </div>
      </section>

      <div className="lv-ticker">
        <div className="lv-ticker-track">
          <ul aria-label="Platforms" className="lv-ticker-copy">
            {PLATFORMS.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <ul aria-hidden="true" className="lv-ticker-copy is-clone">
            {PLATFORMS.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      </div>

      <section ref={essayRef} aria-label="How it works" className="lv-essay">
        {BEATS.map((b) => (
          <p key={b.num} className="lv-essay-line">
            <span className="lv-essay-num">{b.num}</span>
            {words(b.title)}
            <span className="lv-essay-body">{words(b.body)}</span>
          </p>
        ))}
      </section>
    </>
  );
}
