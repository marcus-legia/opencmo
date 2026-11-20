"use client";

import { useEffect, useRef } from "react";

import type { Beat } from "./data";
import { SocialTile } from "./Glyphs";
import { gsap, prefersReducedMotion, ScrollTrigger } from "./motion";

/**
 * One span per word, so each lights up on its own. A phrase between asterisks ("You built it. *Then nobody came.*")
 * is the beat's keyword: its words light up in blue instead of ink. The asterisks never reach the page.
 */
function words(text: string) {
  let key = false;
  return text.split(" ").map((raw, i) => {
    let w = raw;
    if (w.startsWith("*")) {
      key = true;
      w = w.slice(1);
    }
    const end = w.match(/^(.*)\*([.,;:!?]*)$/);
    const inKey = key;
    if (end) {
      w = end[1] + end[2];
      key = false;
    }
    return <span key={i} className={inKey ? "lv-w is-key" : "lv-w"}>{w} </span>;
  });
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
      // Each word tweens only `--lit` (0 → 1); CSS mixes its colour from the theme's tokens. Tweening `color` baked the
      // inks of the theme at load into every word, so a switch to dark (or back) left dark words on a dark page.
      gsap.to(essay.querySelectorAll(".lv-w"), {
        "--lit": 1,
        ease: "none",
        duration: 0.3,
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
