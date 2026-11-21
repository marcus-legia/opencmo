import type { Metadata } from "next";

import "@/styles/login.css";

import { FirstTouch } from "@/components/FirstTouch";
import { LoginForm } from "@/components/LoginForm";
import { LogoMark } from "@/components/landing/Glyphs";
import { absoluteUrl, SITE_NAME, SUPPORT_EMAIL } from "@/lib/site";

import { siteLabel } from "./site-label";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: true } };

/** The error `/auth/callback` puts in the URL → the sentence the person reads. */
const ERRORS: Record<string, string> = {
  "no-code": "Google did not finish signing you in. Please try again.",
  "expired": "That sign-in expired. Please try again.",
  "cancelled": "Sign-in was cancelled.",
};

/**
 * Sign in with Google: no password, no magic link (changed 2026-10-09).
 *
 * Why: one press and you are in; no forgot-password form, no mail to go and find. Drawn in the landing's design
 * (`.site` tokens, 2026-11-21) so the step after "See who's asking" looks like the same product, in light and dark.
 * No sample card beside the form: a made-up thread on the way in would be an invented example (product rules); the
 * side panel says what the scan does instead.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const host = siteLabel(params.site);

  return (
    <div className="site lg-page">
      <FirstTouch />
      <header className="lg-top">
        <a href={absoluteUrl("/")} className="lv-nav-brand" aria-label={`${SITE_NAME} home`}>
          <LogoMark size={26} />
          <span>{SITE_NAME}</span>
        </a>
      </header>

      <main className="lg-main">
        <section className="lg-form" aria-labelledby="login-title">
          <p className="lv-eyebrow">{host ? "Your free scan" : "Sign in"}</p>
          <h1 id="login-title" className="lg-title">
            Sign in to see who is <span className="lv-key">already asking</span> for{" "}
            {host ? <span className="lg-host">{host}</span> : "what you built"}
          </h1>
          {host ? (
            <p className="lg-site" data-testid="login-site">
              We&apos;ll scan <b>{host}</b> after you sign in.
            </p>
          ) : null}
          <p className="lg-lede">
            {SITE_NAME} reads your website, then searches Reddit, Hacker News, Threads and Facebook groups for people
            describing the problem you solve, in their own words.
          </p>

          {params.error ? (
            <p className="lg-error" role="alert">
              {ERRORS[params.error] ?? "Sign-in did not work. Please try again."}
            </p>
          ) : null}

          {/* The website typed on the landing page rides along, so it is not typed again after sign-in. */}
          <LoginForm nextUrl={params.next} siteUrl={params.site} />

          <p className="lg-note">Free scan. No card.</p>
          <p className="lg-fine">
            Ferreto never replies to or messages anyone for you. By continuing you agree to the <a href={absoluteUrl("/terms")}>Terms</a> and
            the <a href={absoluteUrl("/privacy")}>Privacy Policy</a>.
          </p>
        </section>

        <aside className="lg-aside" aria-labelledby="login-next">
          <p id="login-next" className="lv-eyebrow">What the free scan does</p>
          <ol className="lg-steps">
            <li>
              <b>Reads your website</b>
              <span>What you sell, who buys it and the problem it solves.</span>
            </li>
            <li>
              <b>Searches where your buyers write</b>
              <span>Reddit, Hacker News, Threads and Facebook groups.</span>
            </li>
            <li>
              <b>Shows you the people</b>
              <span>Each one with the quote that shows why. Replies are written once you pick a plan, and you post them yourself.</span>
            </li>
          </ol>
        </aside>
      </main>

      <footer className="lg-foot">
        <span>{SITE_NAME} · A customer-finding tool for founders.</span>
        <nav aria-label="Legal" className="lg-foot-links">
          <a href={absoluteUrl("/terms")}>Terms</a>
          <a href={absoluteUrl("/privacy")}>Privacy</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </nav>
      </footer>
    </div>
  );
}
