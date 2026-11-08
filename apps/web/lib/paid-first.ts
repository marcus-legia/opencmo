import "server-only";

import type { SupabaseClient } from "@/lib/api/handler";

import { isPaidPlan } from "./pricing";

/**
 * Paid first, no free trial (owner, 2026-11-08): the CMO does work for an account with a paid plan, or with credits
 * left from before paid-first (a pack, a refund, an old signup gift). Read under RLS as the signed-in user.
 */
export async function hasPlanOrCredits(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const [{ data: profile }, { data: balance }] = await Promise.all([
    supabase.from("profiles").select("plan").eq("id", userId).maybeSingle<{ plan: string }>(),
    supabase.rpc("credit_balance", { p_user_id: userId }),
  ]);
  return isPaidPlan(profile?.plan) || (typeof balance === "number" && balance > 0);
}
