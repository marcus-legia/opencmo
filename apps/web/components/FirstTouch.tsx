"use client";

import { useEffect } from "react";

import {
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_MAX_AGE,
  cookieDomain,
  encodeFirstTouch,
  readFirstTouchCookie,
  touchFromVisit,
} from "@/lib/ops/first-touch";
import { SITE_URL } from "@/lib/site";

/**
 * Keeps the first touch (`?ref=`, `utm_*`, the linking site's host) in a first-party cookie; renders nothing.
 *
 * A client effect, not the server: the landing and the blog are static pages and must not read or write cookies on
 * the server (they would stop being cached), and the blog's own host skips the middleware. Why the cookie is allowed:
 * `lib/ops/first-touch.ts`.
 */
export function FirstTouch() {
  useEffect(() => {
    try {
      if (readFirstTouchCookie(document.cookie)) return;
      const touch = touchFromVisit({
        search: window.location.search,
        referrer: document.referrer,
        path: window.location.pathname,
        siteHost: new URL(SITE_URL).hostname,
      });
      if (!touch) return;
      const domain = cookieDomain(window.location.hostname, new URL(SITE_URL).hostname);
      document.cookie = [
        `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(encodeFirstTouch(touch))}`,
        "path=/",
        `max-age=${FIRST_TOUCH_MAX_AGE}`,
        "samesite=lax",
        domain ? `domain=${domain}` : "",
        window.location.protocol === "https:" ? "secure" : "",
      ].filter(Boolean).join("; ");
    } catch {
      // Cookies blocked: the sign-up is simply not attributed.
    }
  }, []);
  return null;
}
