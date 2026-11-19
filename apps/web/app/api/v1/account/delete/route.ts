import { z } from "zod";

import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().trim().min(3).max(320) });

/**
 * Delete my account (wave 4 C3). `account_delete` checks the typed email, refuses while a plan renews or a video is
 * processing (its messages reach the founder verbatim), records the request and purges the data. The auth user is then
 * removed with the service role, the one thing SQL cannot do; if that fails the founder still hears "done": the daily
 * cleanup cron removes it again from `account_deletions`. The session cookie is cleared last.
 */
export const POST = withApi({ body: Body, rateLimit: { bucket: "project-write", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  const done = await rpcOrThrow<{ user_id: string; files: number } | null>(supabase, "account_delete", { p_email: body.email });
  if (done?.user_id) {
    const { error } = await createAdminClient()
      .auth.admin.deleteUser(done.user_id)
      .catch((thrown: unknown) => ({ error: thrown as Error }));
    if (error) console.error("[account] auth user not deleted; the cleanup cron retries", error.message);
  }
  await supabase.auth.signOut().catch(() => undefined);
  return { deleted: true };
});
