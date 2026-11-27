/**
 * Sentry Cron Monitors for the crons Modal calls (hardening backlog step 3, docs/plans/engineering/2026-11-15-uptime-plan.md).
 *
 * Modal is the only clock (`packages/engine/modal_app.py`). If it stops, or a cron route keeps failing, nothing told
 * anyone: the CMO simply stopped planning and drafting. Each cron now checks in with Sentry, which raises an issue when a
 * check-in is missed or late, or ends in an error.
 *
 * The routes answer a failure with a 5xx instead of throwing, so the check-in is read from the status code (Sentry's own
 * `withMonitor` only sees thrown errors). The monitor is created by the first check-in from its config; there is
 * nothing to set up in Sentry. Without `NEXT_PUBLIC_SENTRY_DSN` (local, CI) the check-ins are no-ops.
 */
import * as Sentry from "@sentry/nextjs";

export type CronMonitor = {
  slug: string;
  /** Modal's schedule for this route, UTC. Keep in step with `modal_app.py`. */
  crontab: string;
  /** Minutes a run may take before Sentry calls it timed out: the route's `maxDuration`, rounded up. */
  maxRuntime: number;
};

export const CRON_MONITORS = {
  cmo: { slug: "cron-cmo", crontab: "5 * * * *", maxRuntime: 6 },
  digest: { slug: "cron-cmo-digest", crontab: "2 * * * *", maxRuntime: 3 },
  cleanup: { slug: "cron-cleanup", crontab: "0 3 * * *", maxRuntime: 2 },
  xNews: { slug: "cron-x-news", crontab: "20 */3 * * *", maxRuntime: 3 },
} as const satisfies Record<string, CronMonitor>;

/** Modal retries a failed call up to twice, a minute apart: a check-in up to 10 minutes late is still on time. */
const CHECKIN_MARGIN_MINUTES = 10;

/** Runs one cron call between an `in_progress` and a final check-in. Call it only after the request is authorized. */
export async function withCronMonitor(
  monitor: CronMonitor,
  run: () => Promise<Response>,
  // Injected by the check; Sentry's own everywhere else.
  sentry: { captureCheckIn: typeof Sentry.captureCheckIn; flush: typeof Sentry.flush } = Sentry,
): Promise<Response> {
  const config = {
    schedule: { type: "crontab" as const, value: monitor.crontab },
    checkinMargin: CHECKIN_MARGIN_MINUTES,
    maxRuntime: monitor.maxRuntime,
    timezone: "Etc/UTC",
  };
  const checkInId = sentry.captureCheckIn({ monitorSlug: monitor.slug, status: "in_progress" }, config);
  const started = Date.now();
  const finish = (status: "ok" | "error") =>
    sentry.captureCheckIn({ checkInId, monitorSlug: monitor.slug, status, duration: (Date.now() - started) / 1000 }, config);
  try {
    const response = await run();
    finish(response.status >= 500 ? "error" : "ok");
    return response;
  } catch (error) {
    finish("error");
    throw error;
  } finally {
    // A serverless function may be frozen as soon as it answers: send the check-ins first.
    await sentry.flush(2_000);
  }
}
