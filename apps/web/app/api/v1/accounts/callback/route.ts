import { NextResponse } from "next/server";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { finishConnect } from "@/lib/departments/publish/accounts";
import { accountsStore } from "@/lib/departments/publish/accounts-store";
import { publishAdapter } from "@/lib/departments/publish/adapter";
import { PublishError } from "@/lib/departments/publish/types";
import { planAfterConnect } from "@/lib/cmo/plan-after-connect";
import { isPlanRequired } from "@/lib/plan-offer";

export const dynamic = "force-dynamic";

/**
 * Where the founder goes after OAuth, by the name the connect route sent (`from`). A name, never a URL out of the
 * query: a path taken from the query would redirect the browser anywhere a link could ask it to. An unknown name
 * falls back to Settings.
 */
const BACK_TO: Record<string, { path: string; tab?: string }> = {
  settings: { path: "/app/settings", tab: "accounts" },
  post: { path: "/app/schedule" },
};

/**
 * Zernio sends the founder back here after OAuth. The account in the query is stored only when Zernio
 * lists it under this founder's profile (`finishConnect`); either way the founder lands on Settings with
 * `connected=<platform>` or `connect_error=<our sentence>`.
 */
export const GET = withApi({ rateLimit: { bucket: "accounts", limit: 30, windowSeconds: 3600 } }, async ({ request, supabase, user }) => {
  // Built on a placeholder origin and sent as a relative Location: `request.nextUrl.origin` says `localhost` on
  // 127.0.0.1 or behind a proxy, a host the session cookie is not on (`app/auth/callback/route.ts`).
  const where = BACK_TO[request.nextUrl.searchParams.get("from") ?? ""] ?? BACK_TO.settings!;
  const back = new URL(where.path, "http://opencmo.invalid");
  if (where.tab) back.searchParams.set("tab", where.tab);
  try {
    const done = await finishConnect({ adapter: publishAdapter(), store: accountsStore(supabase), userId: user.id }, request.nextUrl.searchParams);
    if (done.kind === "connected") {
      back.searchParams.set("connected", done.platform);
      // A week with no posts yet (connected after onboarding) is planned now, not on Monday.
      await planAfterConnect(supabase, user.id);
    }
    else back.searchParams.set("connect_error", done.message);
  } catch (error) {
    if (!(error instanceof PublishError) && !(error instanceof ApiError)) console.error("[accounts] callback failed", error);
    // `social_account_save` refuses a free account (20270206060000): say why instead of "try again".
    const message = isPlanRequired(error)
      ? "Pick a plan to connect an account."
      : error instanceof PublishError
        ? error.message
        : "The account was not connected. Try again.";
    back.searchParams.set("connect_error", message);
  }
  return new NextResponse(null, { status: 303, headers: { location: `${back.pathname}${back.search}` } });
});
