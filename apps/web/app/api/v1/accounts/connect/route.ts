import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { connectUrl, publishErrorStatus } from "@/lib/departments/publish/accounts";
import { accountsStore } from "@/lib/departments/publish/accounts-store";
import { publishAdapter } from "@/lib/departments/publish/adapter";
import { PublishError, PublishPlatformSchema } from "@/lib/departments/publish/types";

export const dynamic = "force-dynamic";

const body = z.object({ platform: PublishPlatformSchema }).strict();

/** Settings → Accounts "Connect" (P4 F1): Zernio's OAuth link; the founder comes back to `/accounts/callback`. */
export const POST = withApi(
  { body, rateLimit: { bucket: "accounts", limit: 30, windowSeconds: 3600 } },
  async ({ request, supabase, user, body }) => {
    try {
      const url = await connectUrl(
        { adapter: publishAdapter(), store: accountsStore(supabase), userId: user.id },
        body.platform,
        new URL("/api/v1/accounts/callback", request.nextUrl.origin).toString(),
      );
      return { url };
    } catch (error) {
      if (error instanceof PublishError) throw new ApiError(publishErrorStatus(error), error.message);
      throw error;
    }
  },
);
