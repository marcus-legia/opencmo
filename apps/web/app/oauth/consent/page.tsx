import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/brand/Brand";
import { PAID_PLAN_CONSENT, paidUser } from "@/lib/auth/consent";
import { createServerClient } from "@/lib/supabase/server";

import { ConsentButtons } from "./ConsentButtons";

export const metadata: Metadata = { title: "Connect to OpenCMO", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * The consent screen of OpenCMO's OAuth server (Supabase Auth, `authorization_url_path`): an app
 * such as Claude asks to use OpenCMO as the signed-in user. Supabase sends the browser here with
 * `authorization_id`; Allow or Deny posts to `/api/v1/oauth/consent`, which hands the answer to
 * Supabase, and the page follows its redirect back to the app. The MCP server (packages/mcp-server) then accepts the
 * token that app receives.
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: id } = await searchParams;
  if (!id || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) return <Consent title="This link is not valid" text="Start connecting again from the app that sent you here." />;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);

  const { data, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (detailsError || !data) return <Consent title="This request has expired" text="Start connecting again from the app that sent you here." />;
  // Already approved for these scopes: Supabase answers with the way back straight away.
  if (!("authorization_id" in data)) redirect(data.redirect_url);

  const client = data.client.name || "An app";
  if (!(await paidUser(supabase, user.id))) {
    return (
      <Consent title={`Connect ${client} to OpenCMO`} text={PAID_PLAN_CONSENT}>
        <p className="auth-consent-note">
          <Link href="/app/billing">See plans</Link>
        </p>
        <ConsentButtons authorizationId={data.authorization_id} denyOnly />
      </Consent>
    );
  }
  return (
    <Consent title={`Connect ${client} to OpenCMO`} text={`${client} wants to use OpenCMO as ${data.user.email}.`}>
      <ul className="auth-consent">
        <li>Read your projects, clips and editing skills.</li>
        <li>Edit your clips. Every change is saved in Version history.</li>
        <li>Start AI media, explainers and exports after you agree to each price.</li>
        <li>It never posts anything for you.</li>
      </ul>
      <ConsentButtons authorizationId={data.authorization_id} />
      <p className="auth-consent-note">
        Redirects to {new URL(data.redirect_uri).host}. You can disconnect it any time in Settings.
      </p>
    </Consent>
  );
}

function Consent({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <main className="auth-page">
      <Link href="/" aria-label="OpenCMO home">
        <Brand />
      </Link>
      <div className="auth-content">
        <section className="auth-form" data-testid="oauth-consent">
          <h1>{title}</h1>
          <p>{text}</p>
          {children}
        </section>
      </div>
      <p className="auth-footer">OpenCMO · The AI CMO for founders.</p>
    </main>
  );
}
