/**
 * What Research shows of a competitor's website (wave 3, C5), taken from the page as written: no model call. Pure, so
 * the check runs without a network.
 */
import type { SiteSnapshot } from "./site";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "Bonsai | Freelance software" → "Bonsai": the part of the title before the first separator. */
export function nameFrom(title: string): string | null {
  const first = title.split(/\s*[|–—·]\s*|:\s|\s-\s/)[0]?.trim() ?? "";
  return first && first.length <= 60 ? first : null;
}

/** The first price the site states ("$21/mo", "from $12 a month", "Free"), as written; null when none. */
export function priceFrom(site: SiteSnapshot): string | null {
  const text = site.pages.map((p) => `${p.description} ${p.text}`).join(" ");
  const money = /(from |starts? at |plans start at )?([$€£]\s?\d[\d,.]*(?:\s?(?:\/|per |a )\s?(?:month|mo|user|seat|year|yr)\b)?)/i.exec(text);
  if (money) return clip(`${money[1] ? "from " : ""}${money[2]!.trim().replace(/[.,]$/, "")}`, 60);
  return /\bfree plan\b|\bfree forever\b/i.test(text) ? "Free plan" : null;
}

/** What it sells, in its own words: the home page's description, else its first sentence. */
export function offerFrom(site: SiteSnapshot): string | null {
  const home = site.pages[0];
  if (!home) return null;
  const line = home.description || home.text.split(/(?<=[.!?])\s/)[0] || "";
  return line.trim() ? clip(line.trim(), 300) : null;
}
