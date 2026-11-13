import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { publishErrorStatus, syncAccounts } from "@/lib/departments/publish/accounts";
import { accountsStore } from "@/lib/departments/publish/accounts-store";
import { publishAdapter } from "@/lib/departments/publish/adapter";
import { PublishError } from "@/lib/departments/publish/types";

export const dynamic = "force-dynamic";

/**
 * Settings → Accounts, on open: accounts Zernio lists under the founder's own profile that are not saved here yet (a
 * connect whose callback never saved it). Answers the accounts it saved; nothing when posting is not set up.
 */
export const POST = withApi({ rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, user }) => {
  try {
    return { saved: await syncAccounts({ adapter: publishAdapter(), store: accountsStore(supabase), userId: user.id }) };
  } catch (error) {
    if (error instanceof PublishError) {
      if (error.code === "not_configured") return { saved: [] };
      throw new ApiError(publishErrorStatus(error), error.message);
    }
    throw error;
  }
});
