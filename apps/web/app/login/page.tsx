import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand/Brand";
import { Arabesque } from "@/components/marketing/Ornament";

import { LoginForm } from "@/components/LoginForm";

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
      <Link href="/" aria-label="OpenCMO home"><Brand /></Link>
      <div className="auth-content">
        <aside className="auth-art">
          <div className="auth-visual" aria-hidden="true">
            <Arabesque id="auth-pattern" />
          </div>
          <h2>Your marketing team is ready.</h2><p>Tell OpenCMO about your business. It plans the week and drafts the work; you approve what goes out.</p></aside>
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
      <p className="auth-footer">OpenCMO · The AI CMO for founders.</p>
    </main>
  );
}
