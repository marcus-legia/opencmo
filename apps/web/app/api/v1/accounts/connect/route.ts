import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { connectUrl, publishErrorStatus } from "@/lib/departments/publish/accounts";
import { accountsStore } from "@/lib/departments/publish/accounts-store";
import { publishAdapter } from "@/lib/departments/publish/adapter";
import { PublishError, PublishPlatformSchema } from "@/lib/departments/publish/types";

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

const body = z.object({ platform: PublishPlatformSchema }).strict();

/** Settings → Accounts "Connect" (P4 F1): Zernio's OAuth link; the founder comes back to `/accounts/callback`. */
export const POST = withApi(
  { body, rateLimit: { bucket: "accounts", limit: 30, windowSeconds: 3600 } },
  async ({ request, supabase, user, body }) => {
    try {
      const url = await connectUrl(
        { adapter: publishAdapter(), store: accountsStore(supabase), userId: user.id },
        body.platform,
        new URL("/api/v1/accounts/callback", requestOrigin(request)).toString(),
      );
      return { url };
    } catch (error) {
      if (error instanceof PublishError) throw new ApiError(publishErrorStatus(error), error.message);
      throw error;
    }
  },
);
