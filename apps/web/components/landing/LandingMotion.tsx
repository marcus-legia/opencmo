"use client";

import { useEffect, useRef } from "react";

import { gsap, prefersReducedMotion, ScrollTrigger, startSmoothScroll } from "./motion";
import { startPixelField } from "./pixel-field";

/** Pixel-field background + smooth scroll + the shared scroll reveals (`data-h`, `data-rise`, `data-slab`). */
export function LandingMotion() {
  const fieldRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = fieldRef.current!;
    const reduced = prefersReducedMotion();
    const stopField = startPixelField(canvas, reduced);
    const stopScroll = startSmoothScroll();
    const root = canvas.parentElement!;
    const ctx = gsap.context(() => {
      if (reduced) return;
      gsap.from(canvas, { opacity: 0, duration: 1.2, ease: "expo.out", delay: 0.2 });
      const goals = root.querySelector("[data-goals]");
      if (goals) gsap.from(goals.querySelectorAll("[data-slab]"), { y: 80, opacity: 0, duration: 1.3, ease: "expo.out", stagger: 0.1, scrollTrigger: { trigger: goals, start: "top 85%" } });
      gsap.utils.toArray<HTMLElement>("[data-h]").forEach((el) => gsap.from(el, { yPercent: 105, duration: 1.4, ease: "expo.out", scrollTrigger: { trigger: el.parentElement, start: "top 88%" } }));
      ScrollTrigger.batch("[data-rise]", { start: "top 90%", onEnter: (els) => gsap.from(els, { y: 32, opacity: 0, duration: 1.1, ease: "expo.out", stagger: 0.06, overwrite: true }) });
    }, root);
    const refresh = setTimeout(() => ScrollTrigger.refresh(), 600);
    return () => {
      clearTimeout(refresh);
      ctx.revert();
      stopScroll();
      stopField();
    };
  }, []);

  return <canvas ref={fieldRef} aria-hidden="true" className="lv-field" />;
}
