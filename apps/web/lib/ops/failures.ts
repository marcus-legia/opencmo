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

/** One warning code from `ops_failure_groups`: uploads published with that fallback. */
export type UploadWarning = {
  code: string;
  jobs: number;
  accounts: number;
  first_seen: string;
  last_seen: string;
  /** Job ids, newest first: for the page only, never sent to Sentry. */
  latest: string[];
};

export type FailuresReport = {
  since: string;
  days: number;
  failures: number;
  accounts: number;
  stuck: number;
  groups: FailureGroup[];
  /** Uploads the worker published with a fallback (`media_manifest.warnings`): they never end `failed`. */
  warnings: UploadWarning[];
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

/**
 * What a warning code from the worker (`packages/engine/opencmo/worker/process_job.py`) means for the founder, in the
 * owner's words. A code the page does not know yet still shows as itself.
 */
const WARNING_LABEL: Record<string, string> = {
  transcript_failed: "Published without a transcript: Scribe failed, so the editor shows no words and no captions.",
  framing_centre_no_detector: "Framed in the centre: the worker has no face detector (the [face] extra, its model or libEGL).",
  framing_centre_no_frames: "Framed in the centre: face tracking could not read a frame of the video.",
  framing_centre_tracking_failed: "Framed in the centre: face tracking raised an error.",
};

export function warningLabel(code: string): string {
  return WARNING_LABEL[code] ?? code;
}
