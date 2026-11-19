import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand/Brand";
import { Arabesque } from "@/components/marketing/Ornament";

import { LoginForm } from "@/components/LoginForm";
import { SITE_NAME } from "@/lib/site";

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
 * Why: one press and you are in; no forgot-password form, no mail to go and find.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; next?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-page">
      <Link href="/" aria-label={`${SITE_NAME} home`}><Brand /></Link>
      <div className="auth-content">
        <aside className="auth-art">
          <div className="auth-visual" aria-hidden="true">
            <Arabesque id="auth-pattern" />
          </div>
          <h2>See who is asking for what you built.</h2>
          <p>Give {SITE_NAME} your website. It finds the people describing the problem you solve, in their own words. Nothing is posted for you.</p>
        </aside>
        <section className="auth-form">
      <h1>Sign in</h1>
      <p>Use your Google account. No password needed.</p>
      {params.error ? (
        <p className="auth-error" role="alert">
          {ERRORS[params.error] ?? "Sign-in did not work. Please try again."}
        </p>
      ) : null}

      {/* The website typed on the landing page rides along, so it is not typed again after sign-in. */}
      <LoginForm nextUrl={params.next} siteUrl={params.site} />
        </section>
      </div>
      <p className="auth-footer">{SITE_NAME} · A customer-finding tool for founders.</p>
    </main>
  );
}
