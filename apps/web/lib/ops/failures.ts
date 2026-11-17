/**
 * The owner's failures page (`/app/settings/failures`): the shape `ops_failures_report` answers, and how a group reads.
 * Pure, so `failures.check.ts` runs it without a database. The report comes sorted (accounts hit, then failures, then
 * the most recent), so the page keeps its order.
 */

import { duration, WINDOWS } from "./funnel";

export { WINDOWS };
export type FailureWindow = (typeof WINDOWS)[number];

/** `?days=` as one of the windows; anything else is the default week. */
export function failureWindow(raw: string | undefined): FailureWindow {
  const n = Number(raw);
  return (WINDOWS as readonly number[]).includes(n) ? (n as FailureWindow) : 7;
}

export type FailureSource =
  | "jobs"
  | "tasks"
  | "cmo_runs"
  | "generations"
  | "studio_steps"
  | "work_orders"
  | "schedule_slots"
  | "agent_turns";

export type FailureRow = { id: string; user_id: string; at: string; error: string; stuck: boolean };

export type FailureGroup = {
  source: FailureSource;
  kind: string;
  key: string;
  failures: number;
  accounts: number;
  first_seen: string;
  last_seen: string;
  stuck: boolean;
  latest: FailureRow[];
};

export type FailuresReport = {
  since: string;
  days: number;
  failures: number;
  accounts: number;
  stuck: number;
  groups: FailureGroup[];
};

/** What the founder was doing, in the owner's words. The table name stays beside it, for the lookup in Supabase. */
const SOURCE_LABEL: Record<FailureSource, string> = {
  jobs: "Video project",
  tasks: "Worker task",
  cmo_runs: "CMO run",
  generations: "AI media",
  studio_steps: "Studio step",
  work_orders: "Work order",
  schedule_slots: "Publish",
  agent_turns: "Editor Assistant",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source as FailureSource] ?? source;
}

/**
 * The grouping key as the owner reads it: the database writes `<id>` and `<n>` where ids and numbers were collapsed;
 * shown as "…" and "N" they read as placeholders, not as markup.
 */
export function displayKey(key: string): string {
  return key.replaceAll("<id>", "…").replaceAll("<n>", "N");
}

/** "3.5 h ago", from an ISO time. */
export function ago(at: string, now: Date = new Date()): string {
  // A clock a little ahead of the database is not "in the future".
  return `${duration(Math.max(0, (now.getTime() - new Date(at).getTime()) / 1000))} ago`;
}
