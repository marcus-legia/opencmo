import { NextResponse } from "next/server";

import { healthReport } from "@/lib/ops/health";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * For the uptime monitor (Sentry Uptime, every minute): 200 when the web app and its database answer, 503 when the
 * database does not. Never cached, so a monitor never sees an old answer. Outside the middleware matcher: a ping a
 * minute needs no session check.
 */
export async function GET() {
  const health = await healthReport();
  return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
