/**
 * The hourly alert on founder failures (web hardening round 4, session B,
 * docs/plans/engineering/2026-11-17-web-hardening-round-4-plan.md).
 *
 * The failures page (`/app/settings/failures`) is read only when the owner opens it. Once an hour `/api/cron/failures`
 * reads the same grouping (`ops_failure_groups`, so the page and the alert never disagree on what one bug is) for the
 * last hour and sends one Sentry event per group. The fingerprint is the group, so Sentry keeps one issue per group and
 * its default "new issue" alert emails the owner once, the first time a group appears; later hours only add events.
 *
 * What leaves for Sentry: the source, the kind, the grouped key and counts. Never a user id, a row id, or one row's
 * error as written. The grouped key is the error with uuids, long tokens and numbers collapsed by the database, so it can
 * still name what the founder was working on (a file name, a site): the plan accepts that, since without the key the
 * issue cannot say which bug it is, and the owner reads the same key on the failures page. Pure, so
 * `failure-alerts.check.ts` runs it without Sentry or a database.
 */
import type { CronMonitor } from "./cron-monitor";
import { displayKey, sourceLabel, warningLabel, type FailureGroup, type UploadWarning } from "./failures";

/** Modal calls the route right after the hourly digest (`cmo_digest` in `modal_app.py`), so it runs on its schedule. */
export const FAILURES_MONITOR = { slug: "cron-failures", crontab: "2 * * * *", maxRuntime: 1 } as const satisfies CronMonitor;

/**
 * The window the alert reads: a little over the hour between runs. The call lands anywhere from :02 to :05 (after the
 * digest), so exactly one hour could leave a gap. It stays short of two hours on purpose: a wider window re-sends
 * failures the last run already reported, and Sentry reopens an issue the owner resolved after a fix as a regression.
 */
export const ALERT_WINDOW_MINUTES = 70;

/** The answer of `ops_failure_groups`. */
export type FailureGroupsAnswer = {
  groups: FailureGroup[];
  warnings: UploadWarning[];
};

export type AlertEvent = {
  message: string;
  level: "error" | "warning";
  fingerprint: string[];
  tags: Record<string, string>;
  extra: Record<string, number | string | boolean>;
};

/** Sentry cuts a message past 8 KB; a short one also reads as an issue title. */
const MAX_MESSAGE = 200;

function cut(text: string): string {
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

/** One event per group: failures and stuck work are errors, an upload's fallback a warning. */
export function alertEvents(answer: FailureGroupsAnswer): AlertEvent[] {
  const failures = (answer.groups ?? []).map(
    (group): AlertEvent => ({
      message: cut(`Founder ${group.stuck ? "work stuck" : "failure"}: ${sourceLabel(group.source)} · ${group.kind}: ${displayKey(group.key)}`),
      level: "error",
      fingerprint: ["founder-failure", group.source, group.kind, group.key],
      tags: { alert: "founder-failure", source: group.source, kind: cut(group.kind) },
      extra: {
        failures: group.failures,
        accounts: group.accounts,
        stuck: group.stuck,
        first_seen: group.first_seen,
        last_seen: group.last_seen,
      },
    }),
  );
  const warnings = (answer.warnings ?? []).map(
    (warning): AlertEvent => ({
      message: cut(`Upload published with a fallback: ${warningLabel(warning.code)}`),
      level: "warning",
      fingerprint: ["founder-failure", "jobs", "warning", warning.code],
      tags: { alert: "founder-failure", source: "jobs", kind: "warning" },
      extra: {
        jobs: warning.jobs,
        accounts: warning.accounts,
        first_seen: warning.first_seen,
        last_seen: warning.last_seen,
      },
    }),
  );
  return [...failures, ...warnings];
}

/** The part of Sentry the alert uses; the route passes Sentry's own, the check a fake. */
export type AlertSink = {
  captureMessage: (
    message: string,
    context: { level: AlertEvent["level"]; fingerprint: string[]; tags: Record<string, string>; extra: AlertEvent["extra"] },
  ) => string;
};

/** Sends each event; the count of what was sent. */
export function sendAlerts(events: AlertEvent[], sink: AlertSink): number {
  for (const event of events) {
    sink.captureMessage(event.message, {
      level: event.level,
      fingerprint: event.fingerprint,
      tags: event.tags,
      extra: event.extra,
    });
  }
  return events.length;
}
