import { NextResponse } from "next/server";

import { type CmoHealth, cmoHealthReport } from "@/lib/ops/cmo-health";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** Reused within one instance, like `/api/health`: a loop of calls costs the database one probe per window. */
const REUSE_MS = 15_000;

let last: { at: number; report: Promise<CmoHealth> } | null = null;

function currentReport(now = Date.now()): Promise<CmoHealth> {
  if (!last || now - last.at >= REUSE_MS) last = { at: now, report: cmoHealthReport() };
  return last.report;
}

/**
 * For the owner's uptime check during launch (wave 4 B2): one line per Sales source (reader set, last read, last
 * failure), the newest scan, and the CMO queue. Public and no personal data: times and counts only. 503 when a source
 * has no reader, failed its last two scans, or the queue is stuck.
 */
export async function GET() {
  const health = await currentReport();
  return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
