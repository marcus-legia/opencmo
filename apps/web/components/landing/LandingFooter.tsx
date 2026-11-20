"use client";

import { useEffect, useRef } from "react";

import { FooterLinks } from "./FooterLinks";
import { gsap, prefersReducedMotion } from "./motion";

/**
 * Footer: the last website form on a brand-colour block, then the link grid, legal row and wordmark (`FooterLinks`,
 * shared with the blog and the legal pages).
 */
export function LandingFooter({ action }: { action: string }) {
  const footRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const intro = gsap.from(ctaRef.current!.children, { y: 40, opacity: 0, duration: 1.4, ease: "expo.out", stagger: 0.12, scrollTrigger: { trigger: footRef.current!, start: "top 70%" } });
    return () => {
      intro.scrollTrigger?.kill();
      intro.kill();
    };
  }, []);

  return (
    <footer ref={footRef} className="lv-footer">
      <div id="start" ref={ctaRef} className="lv-final">
        <span className="lv-mono-eyebrow">Your customers are already talking</span>
        <h2>Find them while the thread is fresh.</h2>
        <form action={action} className="lv-pill-form is-final">
          <label htmlFor="end-site" className="sr-only">Your website</label>
          <input id="end-site" name="site" type="text" inputMode="url" autoComplete="url" required placeholder="yourcompany.com" />
          <button type="submit" className="lv-btn-light">Start with your website</button>
        </form>
      </div>

      <FooterLinks onLanding />
    </footer>
  );
}
