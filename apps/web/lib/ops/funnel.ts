/**
 * The owner's funnel page (`/app/settings/funnel`): the shape `cmo_funnel_report` answers, and how a row reads.
 * Pure, so `funnel.check.ts` runs it without a database.
 */

export const WINDOWS = [7, 30, 90] as const;

export type FunnelStep = "signed_up" | "onboarded" | "free_scan" | "found" | "approved" | "scheduled" | "posted" | "paid";

export type FunnelReport = {
  since: string;
  steps: { step: FunnelStep; users: number }[];
  median_seconds: { onboarded: number | null; approved: number | null; posted: number | null };
  active_7d: { eligible: number; active: number; paid_eligible: number; paid_active: number };
  by_week: { week: string; signed_up: number; onboarded: number; approved: number; posted: number; paid: number }[];
  /** First-touch channel (`ref`, `utm_source`, the linking host, or "direct"), deleted accounts included (`signup_outcomes`). */
  by_channel?: { channel: string; signed_up: number; free_scan: number; found: number; paid: number }[];
};

const LABEL: Record<FunnelStep, string> = {
  signed_up: "Signed up",
  onboarded: "Website read (documents saved)",
  free_scan: "Ran the free scan",
  found: "The scan found someone",
  approved: "Approved a first card",
  scheduled: "Scheduled a post",
  posted: "Posted",
  paid: "Pay (a plan or credits)",
};

/** "42%", or "—" when there is nothing to divide by. */
export function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

/** "45 s", "12 min", "3.5 h", "2.1 days". */
export function duration(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86_400).toFixed(1)} days`;
}

export type FunnelRow = { step: FunnelStep; label: string; users: number; previous: number | null; median: string | null };

/** Rows in the report's order. `previous` is the step before (null for the first, and for "paid", which can come at any point). */
export function funnelRows(report: FunnelReport): FunnelRow[] {
  return report.steps.map((step, i) => ({
    step: step.step,
    label: LABEL[step.step] ?? step.step,
    users: step.users,
    previous: i === 0 || step.step === "paid" ? null : report.steps[i - 1]!.users,
    median: duration(
      step.step === "onboarded" ? report.median_seconds.onboarded
      : step.step === "approved" ? report.median_seconds.approved
      : step.step === "posted" ? report.median_seconds.posted
      : null,
    ),
  }));
}
