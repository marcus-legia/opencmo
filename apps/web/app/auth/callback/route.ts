import { NextResponse, type NextRequest } from "next/server";

import { safeNext } from "@/lib/auth/next";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Redirects with a RELATIVE `Location`.
 *
 * Why not `request.nextUrl.origin`: it does NOT read the `Host` header. Under `next start` behind a proxy, or just
 * served on `127.0.0.1`, it answers `http://localhost:<port>`. The session cookie was just written for the real host,
 * and a redirect to `localhost` is another origin: the browser sends no cookie, `/app` sees nobody and bounces back to
 * `/login`. Sign-in breaks without one line of error. A relative Location lets the browser resolve the real host.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

/**
 * Where Google OAuth (PKCE) lands. Trades the `code` for a session, then goes on into the app.
 *
 * A route handler, not a Server Component: only here can the session cookie be written.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const site = searchParams.get("site");

  // The person pressed Cancel on Google's screen: Supabase sends `error` and no `code`.
  if (searchParams.get("error")) {
    return redirectTo("/login?error=cancelled");
  }
  if (!code) {
    return redirectTo("/login?error=no-code");
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectTo("/login?error=expired");
  }

  // `next` is untrusted user input; `safeNext` keeps it on this site (security fixes plan, fix 3).
  const target = new URL(safeNext(searchParams.get("next")), "http://redirect.invalid");
  // A website typed in the hero goes to `/app` (AI CMO), where W0 Onboarding reads it.
  if (site) target.searchParams.set("site", site);
  return redirectTo(`${target.pathname}${target.search}`);
}
