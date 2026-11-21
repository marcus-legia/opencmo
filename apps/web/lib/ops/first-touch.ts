/**
 * First touch: where a founder came from the first time, kept so the owner can read sign-ups and payments by channel
 * (`?ref=ph`, `?ref=hn`, `utm_source=…`, or the site that linked here).
 *
 * How it travels, with no tracking script and no third party:
 *   1. `components/FirstTouch.tsx` runs on the landing, the blog, the legal pages and /login. When the address has a
 *      `ref`/`utm_*` or the visit came from another site, and no first touch is kept yet, it writes `ferreto_ft`, a
 *      first-party cookie on the site's own domain (so `blog.ferreto.io` and `ferreto.io` share it), for 30 days.
 *   2. `LoginForm` passes the cookie's value along as `ft` on the OAuth callback URL, like `site`.
 *   3. `/auth/callback` reads `ft` (or the cookie), parses it again here and calls `profile_set_first_touch`, which
 *      keeps it on the profile only for an account made in the last day and only once.
 *
 * Why this cookie is allowed by our Privacy Policy: it is a first-party functional cookie that holds only a campaign
 * name and a host (no identifier, nothing unique to the visitor), it is never read by anyone but Ferreto, and it
 * lives as long as a free account does. The Privacy Policy names it (see the "Cookies" section).
 *
 * Pure (no DOM, no server imports) so the client, the callback and `first-touch.check.ts` share one parser. The SQL
 * function checks the same limits again: three layers, like every other input.
 */

export const FIRST_TOUCH_COOKIE = "ferreto_ft";
export const FIRST_TOUCH_MAX_AGE = 30 * 24 * 60 * 60;

export type FirstTouch = {
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  /** The host of the page that linked here, never its path or query. */
  referrer_host?: string;
  /** The first page seen on this site, path only. */
  landing_path?: string;
  /** The day of the first touch, `YYYY-MM-DD` (UTC). */
  day?: string;
};

const TAG_KEYS = ["ref", "utm_source", "utm_medium", "utm_campaign"] as const;

/** A campaign tag: lower case, letters, digits, `.`, `_`, `-`; anything else becomes `-`; 64 characters at most. */
export function cleanTag(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const tag = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return tag || undefined;
}

/** A host name, `www.` dropped, 100 characters at most. */
export function cleanHost(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const host = value.trim().toLowerCase().replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && host.length <= 100 ? host : undefined;
}

/** A path: `/`-led, letters, digits, `/._-` only (a query or a fragment is dropped), 100 characters at most. */
export function cleanPath(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith("/")) return undefined;
  const path = value.split(/[?#]/)[0]!.replace(/[^A-Za-z0-9/._-]+/g, "-").slice(0, 100);
  return path || undefined;
}

function cleanDay(value: string | null | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/** True when `host` is the site itself or one of its subdomains: a click inside the site is not a touch. */
export function isOwnHost(host: string, siteHost: string): boolean {
  const site = siteHost.toLowerCase().replace(/^www\./, "");
  return host === site || host.endsWith(`.${site}`);
}

/**
 * The touch of one page view, or null when there is nothing to keep: a direct visit, or a click from inside the site.
 * A direct first visit writes nothing, so a later visit from a link is still recorded.
 */
export function touchFromVisit(
  { search, referrer, path, siteHost, now = new Date() }: { search: string; referrer: string; path: string; siteHost: string; now?: Date },
): FirstTouch | null {
  const query = new URLSearchParams(search);
  const touch: FirstTouch = {};
  for (const key of TAG_KEYS) {
    const tag = cleanTag(query.get(key));
    if (tag) touch[key] = tag;
  }
  let host: string | undefined;
  try {
    host = referrer ? cleanHost(new URL(referrer).hostname) : undefined;
  } catch {
    host = undefined;
  }
  if (host && !isOwnHost(host, siteHost)) touch.referrer_host = host;
  if (!Object.keys(touch).length) return null;
  const landing = cleanPath(path);
  if (landing) touch.landing_path = landing;
  touch.day = now.toISOString().slice(0, 10);
  return touch;
}

/** The cookie's value: a short query string (`ref=ph&day=2026-11-30`), URL-safe as it is. */
export function encodeFirstTouch(touch: FirstTouch): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(touch)) if (value) query.set(key, value);
  return query.toString();
}

/** Parses a cookie value or an `ft` parameter; every field is cleaned again, unknown keys are dropped. */
export function decodeFirstTouch(raw: string | null | undefined): FirstTouch | null {
  if (!raw || raw.length > 600) return null;
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const touch: FirstTouch = {};
  for (const key of TAG_KEYS) {
    const tag = cleanTag(query.get(key));
    if (tag) touch[key] = tag;
  }
  const host = cleanHost(query.get("referrer_host"));
  if (host) touch.referrer_host = host;
  const path = cleanPath(query.get("landing_path"));
  if (path) touch.landing_path = path;
  const day = cleanDay(query.get("day"));
  if (day) touch.day = day;
  const hasSource = TAG_KEYS.some((key) => touch[key]) || !!touch.referrer_host;
  return hasSource ? touch : null;
}

/** The raw value of the first-touch cookie in a `document.cookie` string, or null. */
export function readFirstTouchCookie(cookies: string): string | null {
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === FIRST_TOUCH_COOKIE) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The `Domain` the cookie is set on: the site's host when the page is on it or on one of its subdomains (so the blog's
 * own host and the site share one cookie), else none (a host-only cookie on a preview or localhost).
 */
export function cookieDomain(pageHost: string, siteHost: string): string | null {
  const site = siteHost.toLowerCase().replace(/^www\./, "");
  if (!site.includes(".") || /^[\d.]+$/.test(site)) return null;
  return isOwnHost(pageHost.toLowerCase(), site) ? site : null;
}
