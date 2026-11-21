/**
 * First-touch parsing and cleaning (lib/ops/first-touch.ts). No database, no DOM.
 *
 *   cd apps/web && npx tsx lib/ops/first-touch.check.ts
 */
import assert from "node:assert/strict";

import {
  cleanHost,
  cleanPath,
  cleanTag,
  cookieDomain,
  decodeFirstTouch,
  encodeFirstTouch,
  readFirstTouchCookie,
  touchFromVisit,
} from "./first-touch";

const now = new Date("2026-11-30T09:00:00Z");
const site = "ferreto.io";

// A Product Hunt link: the tag, the path, the day; no referrer when the browser sent none.
assert.deepEqual(touchFromVisit({ search: "?ref=PH", referrer: "", path: "/", siteHost: site, now }), {
  ref: "ph", landing_path: "/", day: "2026-11-30",
});
// UTM tags and an outside referrer, cleaned.
assert.deepEqual(
  touchFromVisit({
    search: "?utm_source=Hacker%20News&utm_medium=post&utm_campaign=launch+week!!&x=1",
    referrer: "https://news.ycombinator.com/item?id=1",
    path: "/blog/find-customers?x=1",
    siteHost: site,
    now,
  }),
  {
    utm_source: "hacker-news", utm_medium: "post", utm_campaign: "launch-week", referrer_host: "news.ycombinator.com",
    landing_path: "/blog/find-customers", day: "2026-11-30",
  },
);
// Direct visits and clicks inside the site (the blog's own host included) keep nothing.
assert.equal(touchFromVisit({ search: "", referrer: "", path: "/", siteHost: site, now }), null);
assert.equal(touchFromVisit({ search: "", referrer: "https://blog.ferreto.io/post", path: "/login", siteHost: site, now }), null);
assert.equal(touchFromVisit({ search: "", referrer: "https://www.ferreto.io/", path: "/login", siteHost: site, now }), null);
assert.equal(touchFromVisit({ search: "", referrer: "not a url", path: "/", siteHost: site, now }), null);

// Cleaning: charset and length.
assert.equal(cleanTag("<script>alert(1)</script>"), "script-alert-1-script");
assert.equal(cleanTag("a".repeat(200))!.length, 64);
assert.equal(cleanTag("   "), undefined);
assert.equal(cleanHost("WWW.Reddit.com"), "reddit.com");
assert.equal(cleanHost("localhost"), undefined, "a host with no dot is not an outside site");
assert.equal(cleanHost("evil.com/path"), undefined);
assert.equal(cleanPath("//evil.example"), "//evil.example", "a path is only stored, never followed");
assert.equal(cleanPath("javascript:alert(1)"), undefined);

// The cookie round-trips, and a tampered value is cleaned again on the way back.
const touch = { ref: "hn", referrer_host: "news.ycombinator.com", landing_path: "/", day: "2026-11-30" };
assert.deepEqual(decodeFirstTouch(encodeFirstTouch(touch)), touch);
assert.deepEqual(decodeFirstTouch("ref=HN%20!&evil=1&day=yesterday"), { ref: "hn" });
assert.equal(decodeFirstTouch("day=2026-11-30&landing_path=/"), null, "no source, nothing to keep");
assert.equal(decodeFirstTouch("x".repeat(700)), null);
assert.equal(decodeFirstTouch(null), null);

assert.equal(readFirstTouchCookie(`a=1; ferreto_ft=${encodeURIComponent("ref=ph&day=2026-11-30")}; b=2`), "ref=ph&day=2026-11-30");
assert.equal(readFirstTouchCookie("a=1"), null);
assert.equal(readFirstTouchCookie("ferreto_ft=%E0%A4%A"), null, "a broken value is ignored");

// One cookie for the site and its blog host; host-only elsewhere.
assert.equal(cookieDomain("blog.ferreto.io", site), "ferreto.io");
assert.equal(cookieDomain("ferreto.io", site), "ferreto.io");
assert.equal(cookieDomain("opencmo.io", site), null);
assert.equal(cookieDomain("127.0.0.1", "127.0.0.1"), null);
assert.equal(cookieDomain("localhost", "localhost"), null);

console.log("first-touch.check: ok");
