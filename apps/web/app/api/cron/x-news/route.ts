import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/cron-auth";
import { takeSnapshot, type SnapshotRow } from "@/lib/cmo/news/snapshot";
import { CRON_MONITORS, withCronMonitor } from "@/lib/ops/cron-monitor";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProduction } from "@/lib/production";
import { xNewsReady } from "@/lib/x/client";

export const dynamic = "force-dynamic";
/**
 * Five searches of at most 15 s each, one at a time (75 s), the filter (`FILTER_TIMEOUT_MS`, 45 s with its retry), then
 * the insert with its own 30 s: 150 s at worst, inside this.
 */
export const maxDuration = 180;
const INSERT_TIMEOUT_MS = 30_000;

/**
 * The X News snapshot (plan 2026-11-27-content-plan-and-x-news.md, Part B4). Modal's `x_news` cron calls it every
 * three hours, at :20. One run serves every founder: it reads X News with Ferreto's app-only token, sorts the stories
 * with one Haiku call and stores them in `x_news_stories`, which drafts read for up to six hours.
 *
 * Without `X_BEARER_TOKEN` (and outside the fake) it stores nothing: locally it says so, in production it answers 503 so
 * Sentry's cron monitor raises it. A run that fails answers 500 for the same reason; the previous snapshot stays the
 * newest.
 */
async function run(): Promise<NextResponse> {
  if (!xNewsReady()) {
    // In production a missing key is a fault the monitor must raise: every post that must ride the news is refunded.
    if (isProduction()) {
      console.error("[cron] x-news: X_BEARER_TOKEN is not set");
      return NextResponse.json({ error: "X_BEARER_TOKEN is not set." }, { status: 503 });
    }
    return NextResponse.json({ skipped: "X_BEARER_TOKEN is not set" });
  }
  try {
    const result = await takeSnapshot({
      insert: async (rows: SnapshotRow[]) => {
        // The client's clock starts here, not at the route's start: slow searches must not eat the insert's time.
        const admin = createAdminClient(AbortSignal.timeout(INSERT_TIMEOUT_MS));
        // Each story once per snapshot (the unique key): a second insert of the same run adds nothing.
        const { error } = await admin.from("x_news_stories").upsert(rows, { onConflict: "taken_at,story_id", ignoreDuplicates: true });
        if (error) throw new Error(`x_news_stories insert: ${error.message}`);
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron] x-news", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The X News snapshot failed." }, { status: 500 });
  }
}

/** Checks in with Sentry's cron monitor once the caller is the clock (`lib/ops/cron-monitor.ts`). */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"), "x-news")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 401 });
  }
  return withCronMonitor(CRON_MONITORS.xNews, run);
}
