import { NextResponse } from "next/server";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { finishConnect } from "@/lib/departments/publish/accounts";
import { accountsStore } from "@/lib/departments/publish/accounts-store";
import { publishAdapter } from "@/lib/departments/publish/adapter";
import { PublishError } from "@/lib/departments/publish/types";

export const dynamic = "force-dynamic";

const SETTINGS = "/app/settings";

/**
 * Zernio sends the founder back here after OAuth. The account in the query is stored only when Zernio
 * lists it under this founder's profile (`finishConnect`); either way the founder lands on Settings with
 * `connected=<platform>` or `connect_error=<our sentence>`.
 */
export const GET = withApi({ rateLimit: { bucket: "accounts", limit: 30, windowSeconds: 3600 } }, async ({ request, supabase, user }) => {
  // Built on a placeholder origin and sent as a relative Location: `request.nextUrl.origin` says `localhost` on
  // 127.0.0.1 or behind a proxy, a host the session cookie is not on (`app/auth/callback/route.ts`).
  const back = new URL(SETTINGS, "http://opencmo.invalid");
  back.searchParams.set("tab", "accounts");
  try {
    const done = await finishConnect({ adapter: publishAdapter(), store: accountsStore(supabase), userId: user.id }, request.nextUrl.searchParams);
    if (done.kind === "connected") back.searchParams.set("connected", done.platform);
    else back.searchParams.set("connect_error", done.message);
  } catch (error) {
    if (!(error instanceof PublishError) && !(error instanceof ApiError)) console.error("[accounts] callback failed", error);
    back.searchParams.set("connect_error", error instanceof PublishError ? error.message : "The account was not connected. Try again.");
  }
  return new NextResponse(null, { status: 303, headers: { location: `${back.pathname}${back.search}` } });
});
