import "server-only";

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

/** Paid first (2026-11-08), read under RLS: a plan on sale or credits left. B5 removes its last callers. */
export async function hasPlanOrCredits(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { error } = await supabase.rpc("cmo_require_paid", { p_user: userId });
  return !error;
}
