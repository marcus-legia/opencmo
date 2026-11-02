import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { disconnectAccount, publishErrorStatus } from "@/lib/departments/publish/accounts";
import { accountsStore } from "@/lib/departments/publish/accounts-store";
import { publishAdapter } from "@/lib/departments/publish/adapter";
import { PublishError } from "@/lib/departments/publish/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Settings → Accounts "Disconnect": removed at Zernio first, then here (`disconnectAccount`). */
export const DELETE = withApi({ rateLimit: { bucket: "accounts", limit: 30, windowSeconds: 3600 } }, async ({ supabase, user, params }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Account not found.");
  try {
    const removed = await disconnectAccount({ adapter: publishAdapter(), store: accountsStore(supabase), userId: user.id }, params.id!);
    if (!removed) throw new ApiError(404, "Account not found.");
    return { disconnected: true };
  } catch (error) {
    if (error instanceof PublishError) throw new ApiError(publishErrorStatus(error), error.message);
    throw error;
  }
});
