import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How many cards wait for the founder's decision: the badge next to Dashboard on the rail.
 *
 * One rule for every surface since A0: `approvals` rows with status `waiting` (the Dashboard queue counts the same
 * rows). Approved posts waiting to be posted do not count: nothing is left to decide.
 *
 * Read under RLS with the session's client, counting only (`head: true`). Errors return null:
 * this is a hint on the rail and must not break the shell.
 */
export async function cmoPending(supabase: SupabaseClient): Promise<number | null> {
  const { count, error } = await supabase.from("approvals").select("id", { count: "exact", head: true }).eq("status", "waiting");
  if (error) return null;
  return count ?? 0;
}
