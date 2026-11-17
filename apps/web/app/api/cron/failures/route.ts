import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/cron-auth";
import { withCronMonitor } from "@/lib/ops/cron-monitor";
import { ALERT_WINDOW_MINUTES, alertEvents, FAILURES_MONITOR, sendAlerts, type FailureGroupsAnswer } from "@/lib/ops/failure-alerts";
import { readSentryDsn } from "@/lib/ops/sentry-dsn";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tells the owner, through Sentry, when founders start failing (`lib/ops/failure-alerts.ts`). Modal calls it once an
 * hour, after the digest. Service role: `ops_failure_groups` answers nobody else, since it has no owner check.
 */
async function run() {
  if (readSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN).state !== "ok") {
    // Nowhere to send: no point reading the database.
    return NextResponse.json({ sent: 0, sentry: false });
  }
  const admin = createAdminClient(AbortSignal.timeout((maxDuration - 10) * 1000));
  const since = new Date(Date.now() - ALERT_WINDOW_MINUTES * 60_000).toISOString();
  const { data, error } = await admin.rpc("ops_failure_groups", { p_since: since });
  if (error || !data) {
    console.error("[cron] failures: ops_failure_groups failed", error?.message ?? "no data");
    return NextResponse.json({ error: "Could not read failures." }, { status: 500 });
  }
  const sent = sendAlerts(alertEvents(data as FailureGroupsAnswer), Sentry);
  // `withCronMonitor` flushes before answering, so the events leave with the check-in.
  return NextResponse.json({ sent, sentry: true });
}

/** Checks in with Sentry's cron monitor once the caller is the clock (`lib/ops/cron-monitor.ts`). */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"), "failures")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 401 });
  }
  return withCronMonitor(FAILURES_MONITOR, run);
}
