import { NextResponse } from "next/server";

import { type Health, healthReport } from "@/lib/ops/health";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * The route is public and does two database reads, one under the service role. Within one instance a report is
 * reused for this long (and concurrent calls share the one in flight), so a loop of calls costs the database at most
 * one probe per instance per window. The monitor calls once a minute: it never sees an answer older than this.
 */
const REUSE_MS = 15_000;

let last: { at: number; report: Promise<Health> } | null = null;

function currentReport(now = Date.now()): Promise<Health> {
  if (!last || now - last.at >= REUSE_MS) last = { at: now, report: healthReport() };
  return last.report;
}

/**
 * For the uptime monitor (Sentry Uptime, every minute): 200 when the web app, its database and the job queue answer,
 * 503 when the database does not or a job has waited too long. No CDN or browser cache (`no-store`); only the short
 * in-instance reuse above. Outside the middleware matcher: a ping a minute needs no session check.
 */
export async function GET() {
  const health = await currentReport();
  return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
