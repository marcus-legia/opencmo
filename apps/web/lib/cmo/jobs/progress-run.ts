import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { progressReport, replanBrief, stuckReason, type OrderLedgerRow } from "./progress";

/** `cmo_job_price` (SQL), for telling an order with no credits from one that needs none. */
const PRICES: Record<string, number> = { plan_week: 1, post_draft: 1, sales_scan: 5, competitor_research: 2 };

export type ProgressOutcome = { users: number; stuck: number; replanned: number; overBudget: number };

/**
 * The daily progress check over every founder's current week (service role, from the CMO cron). Code only: it
 * classifies orders and, for at most one stuck order per founder, enqueues a `plan_week` run whose brief says
 * what is stuck. That is the only model call it can cause. Paused founders are skipped (`cmo_enqueue` refuses).
 */
export async function runProgressCheck(admin: SupabaseClient, now = new Date()): Promise<ProgressOutcome> {
  const week = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)))
    .toISOString()
    .slice(0, 10);
  const { data, error } = await admin
    .from("work_orders")
    .select("id, user_id, parent_id, kind, title, department, status, due_at, budget_credits, spent_credits, updated_at, brief, error")
    .eq("week", week)
    .limit(5000);
  if (error) throw new Error(`work_orders: ${error.message}`);
  const byUser = new Map<string, OrderLedgerRow[]>();
  for (const row of (data ?? []) as (OrderLedgerRow & { user_id: string })[]) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  }

  const outcome: ProgressOutcome = { users: byUser.size, stuck: 0, replanned: 0, overBudget: 0 };
  for (const [user, orders] of byUser) {
    const report = progressReport(orders, now, PRICES);
    outcome.stuck += report.stuck.length;
    outcome.overBudget += report.overBudget.length;
    if (!report.replan) continue;
    const order = report.replan;
    const { error: enqueueError } = await admin.rpc("enqueue_cmo_run_for", {
      p_user: user,
      p_kind: "plan_week",
      p_input: { source: "replan", loop: "progress-check", replan_of: order.id, brief: replanBrief(order, now) },
    });
    if (enqueueError) {
      // Paused, out of credits or at the daily cap: try again tomorrow, the order stays stuck and visible.
      console.warn("[cmo] progress check: no replan", user, enqueueError.message);
      continue;
    }
    const { error: markError } = await admin.rpc("work_order_mark_replanned", { p_id: order.id, p_problem: stuckReason(order, now) });
    if (markError) console.warn("[cmo] progress check: could not mark the replan", order.id, markError.message);
    else outcome.replanned += 1;
  }
  return outcome;
}
