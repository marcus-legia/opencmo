import "server-only";

import type { SupabaseClient } from "@/lib/api/handler";

import { startCmoRun } from "./jobs/start";

/**
 * Plans the week right after a platform is connected, when nothing is planned from today on.
 *
 * Posts are written only for connected platforms (`connectedOnly`), so a founder who onboards before connecting
 * anything gets a week plan with no posts, and the weekly plan runs again only on Monday. Connecting X on a Tuesday
 * then left the Post page empty for six days. A week that already has posts is left alone: `cmo_plan_week` replaces
 * the planned items from today, so planning again beside a post already drafted today would add a second one.
 *
 * Never fails the connect: the account is saved either way, and a plan that cannot start (paused, no credits, today's
 * limit) waits for Monday as before.
 */
export async function planAfterConnect(supabase: SupabaseClient, userId: string, now = new Date()): Promise<boolean> {
  const today = now.toISOString().slice(0, 10);
  const { count, error } = await supabase
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("department", "post")
    .gte("day", today)
    .neq("status", "skipped");
  if (error) {
    console.error("[accounts] week not read after connect", error.message);
    return false;
  }
  if ((count ?? 0) > 0) return false;
  try {
    await startCmoRun(supabase, "plan_week", { source: "connect" });
    return true;
  } catch (error) {
    console.error("[accounts] week not planned after connect", error instanceof Error ? error.message : error);
    return false;
  }
}
