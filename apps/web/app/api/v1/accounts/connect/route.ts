import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { connectUrl, publishErrorStatus } from "@/lib/departments/publish/accounts";
import { accountsStore } from "@/lib/departments/publish/accounts-store";
import { publishAdapter } from "@/lib/departments/publish/adapter";
import { CONNECTABLE_PLATFORMS, PublishError } from "@/lib/departments/publish/types";
import { requirePaid } from "@/lib/paid-first";

export const dynamic = "force-dynamic";

/**
 * The origin the founder's browser used. `request.nextUrl.origin` does not read the Host header: served on 127.0.0.1
 * or behind a proxy it says `localhost`, the browser comes back from Zernio to a host its session cookie is not on, and
 * the callback answers "Please sign in again" (`app/auth/callback/route.ts` has the same trap).
 */
function requestOrigin(request: { headers: Headers; nextUrl: URL }): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(/:$/, "");
  return `${proto}://${host.split(",")[0]!.trim()}`;
}

/**
 * Where the founder started, by name, never a URL they sent: the callback turns it back into a path from its own
 * allowlist, so nothing here can redirect the browser off the site.
 */
const body = z.object({ platform: z.enum(CONNECTABLE_PLATFORMS), from: z.enum(["settings", "post"]).optional() }).strict();

/** Settings → Accounts "Connect" (P4 F1): Zernio's OAuth link; the founder comes back to `/accounts/callback`. */
export const POST = withApi(
  { body, rateLimit: { bucket: "accounts", limit: 30, windowSeconds: 3600 } },
  async ({ request, supabase, user, body }) => {
    // Zernio bills each connected account by the day, so connecting needs a plan (owner 2026-11-26). Asked here, before
    // Zernio's page, so a free founder sees the plan sheet instead of signing in for nothing; `social_account_save`
    // refuses the same account at the callback.
    await requirePaid(supabase, user.id);
    try {
      // `connectUrl` adds `platform` to this URL and Zernio hands it all back, so `from` rides along the same way.
      const callback = new URL("/api/v1/accounts/callback", requestOrigin(request));
      if (body.from) callback.searchParams.set("from", body.from);
      const url = await connectUrl(
        { adapter: publishAdapter(), store: accountsStore(supabase), userId: user.id },
        body.platform,
        callback.toString(),
      );
      return { url };
    } catch (error) {
      if (error instanceof PublishError) throw new ApiError(publishErrorStatus(error), error.message);
      throw error;
    }
  },
);
