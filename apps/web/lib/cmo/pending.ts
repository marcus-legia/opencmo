import type { SupabaseClient } from "@supabase/supabase-js";

import { UI_V2 } from "@/lib/screens/flag";

/** The cards today's (v1) inbox can decide; goal and rule cards are only decided on the v2 Dashboard. */
const V1_KINDS = ["post", "reply"];

/**
 * How many cards wait for the founder's decision: the badge next to Dashboard on the rail.
 *
 * One rule for every surface since A0: `approvals` rows with status `waiting` (the Dashboard queue counts the same
 * rows). With the v2 flag off only the kinds the v1 inbox can clear count, so the badge never points at cards the
 * founder has nowhere to decide. Approved posts waiting to be posted do not count: nothing is left to decide.
 *
 * Read under RLS with the session's client, counting only (`head: true`). Errors return null:
 * this is a hint on the rail and must not break the shell.
 */
export async function cmoPending(supabase: SupabaseClient): Promise<number | null> {
  let query = supabase.from("approvals").select("id", { count: "exact", head: true }).eq("status", "waiting");
  if (!UI_V2) query = query.in("kind", V1_KINDS);
  const { count, error } = await query;
  if (error) return null;
  return count ?? 0;
}
