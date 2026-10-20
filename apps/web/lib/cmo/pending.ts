import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How many items wait for the user's decision: the "N waiting" line under Dashboard on the rail.
 *
 * Same rule as "Awaiting your approval" in `loadWorkspace()`: X posts and Reddit threads
 * `in_review`. Approved posts (waiting to be posted) do not count: nothing is left to decide.
 *
 * Read under RLS with the session's client, counting only (`head: true`). Errors return null:
 * this is a hint on the rail and must not break the shell.
 */
export async function cmoPending(supabase: SupabaseClient): Promise<number | null> {
  const count = (table: string) => supabase.from(table).select("id", { count: "exact", head: true }).eq("status", "in_review");
  const [posts, threads] = await Promise.all([count("content_items").eq("department", "post"), count("opportunities")]);
  if (posts.error || threads.error) return null;
  return (posts.count ?? 0) + (threads.count ?? 0);
}
