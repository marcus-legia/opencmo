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

/** Work `my_usage_state()` names in `stopped` / `still_works`; the screens write the words. */
export type UsageWork =
  | "read"
  | "edit"
  | "copy_drafts"
  | "post_drafts"
  | "reply_drafts"
  | "sales_scan"
  | "research";

const USAGE_WORK: readonly UsageWork[] = [
  "read",
  "edit",
  "copy_drafts",
  "post_drafts",
  "reply_drafts",
  "sales_scan",
  "research",
];

/**
 * The state the "100% used" and "free scan used" screens read, from `my_usage_state()` (wave 4 A1). `blocked` means
 * included work is stopped: at 100% of a paid plan (`allowance_used`, until `resetsAt`), or after a free account's
 * free scan (`free_scan_used`, until it takes a plan). The refusals stay in SQL; this only says what they will say.
 */
export type UsageState = PlanUsage & {
  blocked: boolean;
  reason: "allowance_used" | "free_scan_used" | null;
  stopped: UsageWork[];
  stillWorks: UsageWork[];
  /** Free accounts only: where their free scan stands. */
  freeScan: "not_ready" | "available" | "running" | "used" | null;
};

/** What a screen shows when the RPC has not answered: nothing stopped, so nothing is hidden behind a lock. */
export const OPEN_USAGE_STATE: UsageState = {
  ...FREE_USAGE,
  blocked: false,
  reason: null,
  stopped: [],
  stillWorks: ["read", "edit", "copy_drafts"],
  freeScan: null,
};

function works(value: unknown): UsageWork[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is UsageWork => USAGE_WORK.includes(v as UsageWork));
}

/** Reads the `my_usage_state()` jsonb. The bar's numbers go through {@link parsePlanUsage}, so both reads agree. */
export function parseUsageState(value: unknown): UsageState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...OPEN_USAGE_STATE };
  const o = value as Record<string, unknown>;
  const usage = parsePlanUsage(o);
  const reason =
    usage.plan === "pro" && o.reason === "allowance_used"
      ? "allowance_used"
      : usage.plan === "free" && o.reason === "free_scan_used"
        ? "free_scan_used"
        : null;
  const freeScan =
    usage.plan === "free" &&
    (o.free_scan === "not_ready" || o.free_scan === "available" || o.free_scan === "running" || o.free_scan === "used")
      ? o.free_scan
      : null;
  return {
    ...usage,
    blocked: o.blocked === true && reason !== null,
    reason: o.blocked === true ? reason : null,
    stopped: o.blocked === true && reason !== null ? works(o.stopped) : [],
    stillWorks: works(o.still_works),
    freeScan,
  };
}
