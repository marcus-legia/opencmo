"use client";

import { useEffect, useRef } from "react";

import type { Beat } from "./data";
import { SocialTile } from "./Glyphs";
import { gsap, prefersReducedMotion, ScrollTrigger } from "./motion";

function words(text: string) {
  return text.split(" ").map((w, i) => <span key={i} className="lv-w">{w} </span>);
}

/**
 * A large statement in numbered beats whose words darken as the reader scrolls through it. Used for the story under
 * the hero and for the Sales → Post → Video walkthrough. Without JS or with reduced motion it renders in full ink,
 * and the text is in the HTML from the start (SEO).
 */
export function ScrollEssay({ beats, label, id, eyebrow }: { beats: Beat[]; label: string; id?: string; eyebrow?: string }) {
  const essayRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const essay = essayRef.current!;
    essay.dataset.armed = "1";
    const ctx = gsap.context(() => {
      // GSAP cannot tween `var()`, so resolve the two target inks once.
      const css = getComputedStyle(essay);
      const ink = css.getPropertyValue("--ink").trim(), ink2 = css.getPropertyValue("--ink2").trim();
      gsap.to(essay.querySelectorAll(".lv-w"), {
        color: (_: number, el: Element) => (el.closest(".lv-essay-body") ? ink2 : ink),
        ease: "none",
        stagger: 0.1,
        scrollTrigger: { trigger: essay, start: "top 70%", end: "bottom 55%", scrub: 1.5 },
      });
    }, essay);
    const refresh = setTimeout(() => ScrollTrigger.refresh(), 600);
    return () => {
      clearTimeout(refresh);
      ctx.revert();
      delete essay.dataset.armed;
    };
  }, []);

  return (
    <section id={id} ref={essayRef} aria-label={label} className="lv-essay">
      {eyebrow && <p className="lv-eyebrow">{eyebrow}</p>}
      {beats.map((b) => (
        <div key={b.num} className="lv-essay-beat">
          <p className="lv-essay-line">
            <span className="lv-essay-num">{b.num}</span>
            {words(b.title)}
            <span className="lv-essay-body">{words(b.body)}</span>
          </p>
          {b.logos && (
            <ul className="lv-chips lv-essay-logos" aria-label="Platforms">
              {b.logos.map((k) => (
                <li key={k}><SocialTile k={k} size={34} radius={4} /></li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
