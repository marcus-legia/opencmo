/**
 * Who may approve an OAuth connection to OpenCMO (`/oauth/consent` and `api/v1/oauth/consent`).
 * One place, so the page never offers an Allow that the route would refuse.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Shown to a free account instead of Allow (security fixes plan, fix 5). */
export const PAID_PLAN_CONSENT = "Connecting apps to OpenCMO is part of the paid plans. Choose a plan on the Credits page, then connect again.";

/** SQL `is_paid` is the single definition; any error counts as unpaid. */
export async function paidUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_paid", { p_user: userId });
  return !error && data === true;
}
