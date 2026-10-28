import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/cron-auth";
import { buildDigest, digestSender, loadDigestInput, localClock } from "@/lib/cmo/digest";
import { readAll } from "@/lib/cmo/jobs/progress-run";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Sends the morning digest to founders whose local hour is their `digest_hour`. Meant to be called once an hour
 * (calling it twice in one hour sends twice). With no sender (production until A2) it only counts: the digest is
 * on the Dashboard either way.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"), "cmo-digest")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 401 });
  }
  const admin = createAdminClient(AbortSignal.timeout((maxDuration - 10) * 1000));
  const send = digestSender();
  const now = new Date();
  type Profile = { id: string; email: string | null; timezone: string; digest_hour: number };
  let profiles: Profile[];
  try {
    profiles = await readAll<Profile>((from, to) =>
      admin.from("profiles").select("id, email, timezone, digest_hour").not("digest_hour", "is", null).order("id").range(from, to),
    );
  } catch {
    return NextResponse.json({ error: "Could not read founders." }, { status: 500 });
  }

  let due = 0;
  let sent = 0;
  for (const profile of profiles) {
    const clock = localClock(now, profile.timezone);
    if (clock.hour !== profile.digest_hour || !profile.email) continue;
    due += 1;
    if (!send) continue;
    try {
      const digest = buildDigest(await loadDigestInput(admin, profile.id, { appUrl: SITE_URL, dateLabel: clock.dateLabel, now }));
      if (digest.empty) continue;
      await send(profile.email, digest);
      sent += 1;
    } catch (err) {
      console.warn("[cron] cmo-digest: not sent", profile.id, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ due, sent, sender: send ? "local" : null });
}
