import "server-only";

import { ApiError, apiErrorFromPostgrest } from "@/lib/api/errors";
import { rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";

/**
 * The paywall (CMO review 3, plan §3.1): the first run is free; the first action that sends something out or costs
 * credits again needs a plan. The rule lives in SQL (`cmo_require_paid`: a plan on sale, or credits left from before
 * paid-first) so routes, RPCs and MCP agree. It answers SQLSTATE P0402, which `lib/api/errors.ts` turns into a 402
 * with `detail.code = "plan_required"`; the client shows `PlanSheet`.
 *
 * Throws that 402 `ApiError` for an account without a plan. Called before any model call or credit hold.
 */
export async function requirePaid(supabase: SupabaseClient, userId: string): Promise<void> {
  await rpcOrThrow(supabase, "cmo_require_paid", { p_user: userId });
}


/**
 * The CMO chat is paid work after the free first run: a turn of a CMO session (starting or continuing) checks the plan
 * before any model call. Other sessions (the editor's Assistant) keep their own checks. A session that is not the
 * founder's reads as not found under RLS.
 */
export async function requirePaidForCmoSession(supabase: SupabaseClient, userId: string, sessionId: string): Promise<void> {
  const { data, error } = await supabase.from("agent_sessions").select("scope").eq("id", sessionId).maybeSingle<{ scope: string | null }>();
  if (error) throw apiErrorFromPostgrest(error);
  if (!data) throw new ApiError(404, "Conversation not found.");
  if (data.scope === "cmo") await requirePaid(supabase, userId);
}
