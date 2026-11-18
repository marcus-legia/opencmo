/**
 * The fair-use bar: how much of this period's allowance a founder has used. Credits keep working underneath; the
 * screens show a percentage instead of a price per click. The numbers come from the `plan_usage()` RPC (the founder's
 * own row, under RLS); this file only gives the row one shape the top bar, Settings and the loader agree on.
 */

export type PlanUsage = {
  plan: "free" | "pro";
  interval: "month" | "year" | null;
  used: number; // credits spent this period
  allowance: number; // credits the plan gives per period (billing_catalog.credits)
  percent: number; // 0..100, rounded down
  resetsAt: string | null;
  paused: boolean; // percent >= 100: new scans wait for the reset
};

/** What a screen shows when the RPC has not answered: a free account, nothing used, never paused. */
export const FREE_USAGE: PlanUsage = {
  plan: "free",
  interval: null,
  used: 0,
  allowance: 0,
  percent: 0,
  resetsAt: null,
  paused: false,
};

function count(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Reads one `plan_usage()` row (snake_case from Postgres, or the camelCase shape itself). The percentage and the pause
 * are worked out again from `used` and `allowance`, so a screen never shows "100% used" next to a scan that still runs,
 * or the other way round. Anything unreadable falls back to {@link FREE_USAGE}: a free bar hides nothing a founder paid for,
 * and the RPC still refuses a paused scan on its own.
 */
export function parsePlanUsage(row: unknown): PlanUsage {
  const r = Array.isArray(row) ? row[0] : row;
  if (!r || typeof r !== "object") return { ...FREE_USAGE };
  const o = r as Record<string, unknown>;
  if (o.plan !== "pro") return { ...FREE_USAGE };
  const used = count(o.used);
  const allowance = count(o.allowance);
  const percent = allowance > 0 ? Math.min(100, Math.floor((used * 100) / allowance)) : 0;
  const interval = o.interval === "month" || o.interval === "year" ? o.interval : null;
  const rawReset = o.resets_at ?? o.resetsAt;
  const resetsAt = typeof rawReset === "string" && !Number.isNaN(Date.parse(rawReset)) ? rawReset : null;
  return { plan: "pro", interval, used, allowance, percent, resetsAt, paused: allowance > 0 && used >= allowance };
}
