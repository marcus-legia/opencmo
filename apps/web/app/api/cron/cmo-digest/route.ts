import { NextResponse, type NextRequest } from "next/server";
import { CRON_MONITORS, withCronMonitor } from "@/lib/ops/cron-monitor";

import { cmoPausedEverywhere } from "@/lib/cmo/pause";
import { cronAuthorized } from "@/lib/cron-auth";
import { localClock } from "@/lib/cmo/digest";
import { readAll } from "@/lib/cmo/jobs/progress-run";
import { emailSender } from "@/lib/notify/email";
import { pushNewCards, vapidFromEnv } from "@/lib/notify/push";
import { pushAutopilotSoon } from "@/lib/notify/autopilot";
import { pushStrongMatches } from "@/lib/notify/strong-match";
import { digestDue, sendDigestEmail, type Founder } from "@/lib/notify/send";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Releases held cards whose day has come, then sends the morning digest to founders at their `digest_hour` on the days
 * `digest_days` allows (or up to two hours after, when today's has not gone out: a failed send is retried; a morning
 * with nothing new is logged as skipped), one push per autopilot post two hours before it
 * goes out, and one push per browser for new cards. Called once an hour; `email_log_claim` makes a second call send
 * nothing twice. With no sender it only counts: the digest is on the Dashboard anyway.
 */
async function run(request: NextRequest) {
  const started = Date.now();
  if (!cronAuthorized(request.headers.get("authorization"), "cmo-digest")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 401 });
  }
  const admin = createAdminClient(AbortSignal.timeout((maxDuration - 10) * 1000));
  // Cards held past a day's budget (P6 A4) come back first, so the morning digest names them.
  const released = await admin.rpc("approval_release_held", { p_limit: 500 });
  if (released.error) console.warn("[cron] cmo-digest: held cards not released", released.error.message);
  // Autopilot (owner, 2026-11-12): posts whose review window is over are approved for their founders, each through
  // the founder's own `approval_decide`. Not while the CMO is paused everywhere.
  if (!cmoPausedEverywhere()) {
    const auto = await admin.rpc("approval_auto_decide", { p_limit: 200 });
    if (auto.error) console.error("[cron] cmo-digest: autopilot did not run", auto.error.message);
    else if (auto.data) console.log(`[cron] cmo-digest: autopilot approved ${auto.data} posts`);
  }
  const send = emailSender();
  const now = new Date();
  let profiles: Founder[];
  try {
    profiles = await readAll<Founder>((from, to) =>
      admin.from("profiles").select("id, email, timezone, digest_hour, digest_days").not("digest_hour", "is", null).neq("digest_days", "off").order("id").range(from, to),
    );
  } catch {
    return NextResponse.json({ error: "Could not read founders." }, { status: 500 });
  }

  let due = 0;
  let sent = 0;
  let skipped = 0;
  for (const profile of profiles) {
    if (!digestDue(localClock(now, profile.timezone), profile) || !profile.email) continue;
    due += 1;
    if (!send) continue;
    try {
      const outcome = await sendDigestEmail(admin, send, profile, { appUrl: SITE_URL, now });
      if (outcome === "sent") sent += 1;
      else if (outcome === "skipped") skipped += 1;
    } catch (err) {
      console.warn("[cron] cmo-digest: not sent", profile.id, err instanceof Error ? err.message : err);
    }
  }
  // One push per browser for the cards raised since its last push (P6 C1); none without VAPID keys.
  let pushed = 0;
  let autopilot = 0;
  let strong = 0;
  const vapid = vapidFromEnv();
  if (vapid) {
    // Autopilot posts going out within two hours: one push per card, before the round of new cards.
    try {
      autopilot = await pushAutopilotSoon(admin, vapid, fetch, { now, deadline: started + (maxDuration - 50) * 1000 });
    } catch (err) {
      console.warn("[cron] cmo-digest: autopilot pushes not sent", err instanceof Error ? err.message : err);
    }
    // Strong matches a scan's own push missed (it ran on Modal's sweep, or the push failed): one per card, as there.
    try {
      strong = await pushStrongMatches(admin, vapid, fetch, { now, deadline: started + (maxDuration - 40) * 1000 });
    } catch (err) {
      console.warn("[cron] cmo-digest: strong-match pushes not sent", err instanceof Error ? err.message : err);
    }
    try {
      // A batch can take one push timeout (10 s) past the deadline; the admin client gives up at maxDuration - 10 s.
      pushed = await pushNewCards(admin, vapid, fetch, { deadline: started + (maxDuration - 25) * 1000 });
    } catch (err) {
      console.warn("[cron] cmo-digest: pushes not sent", err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ due, sent, skipped, pushed, autopilot, strong, released: released.data ?? 0, sender: send?.name ?? null });
}

/** Checks in with Sentry's cron monitor once the caller is the clock (`lib/ops/cron-monitor.ts`). */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"), "cmo-digest")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 401 });
  }
  return withCronMonitor(CRON_MONITORS.digest, () => run(request));
}
