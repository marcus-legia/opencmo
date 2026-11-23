"use client";

import { useState } from "react";

import { logoSrc } from "@/lib/cmo/logo";

const LETTER_COLORS = ["#3b4cca", "#b45309", "#0e7490", "#be185d", "#15803d", "#6b5b3e", "#7c3aed", "#b4402f"];

function letterColor(name: string): string {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return LETTER_COLORS[n % LETTER_COLORS.length]!;
}

/**
 * A company's own icon (owner, 2026-11-23: competitors with their logos, and yours shown too). No site or no icon:
 * the first letter on a colour taken from the name. `you` rings it in the Sales colour. No name yet (the workspace is
 * still loading): a blank tile, so the page never flashes a placeholder letter before the real logo.
 */
export function CompanyLogo({ name, site, size = 22, you = false }: { name: string; site?: string | null; size?: number; you?: boolean }) {
  const src = logoSrc(site);
  const [broken, setBroken] = useState(false);
  const radius = Math.round(size * 0.27);
  const cls = you ? "co-logo co-you" : "co-logo";
  if (!name.trim()) return <span className={cls} data-wait="" aria-hidden="true" style={{ width: size, height: size, borderRadius: radius }} />;
  if (!src || broken) {
    return (
      <span className={cls} data-letter="" aria-hidden="true" style={{ width: size, height: size, borderRadius: radius, background: letterColor(name), fontSize: Math.round(size * 0.5) }}>
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    <span className={cls} aria-hidden="true" style={{ width: size, height: size, borderRadius: radius, padding: Math.max(1, Math.round(size * 0.1)) }}>
      <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}
