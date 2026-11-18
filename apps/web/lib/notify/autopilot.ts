/**
 * A push before an autopilot post goes out (wave 2, B3; the expiring-card email is gone). Autopilot approves an
 * untouched post card at its `auto_at`; two hours before, each of the founder's browsers gets one push, once per card,
 * logged as `push` in `email_log`. The push has no payload (`push.ts`): the service worker asks
 * `/api/v1/notify/next` for the line it shows, and a tap opens the card, where the founder edits or skips it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { PUSH_BATCH, PUSH_HOSTS, sendPush, type Vapid } from "./push";

/** How long before an autopilot post goes out its push is sent. */
export const AUTOPILOT_PUSH_HOURS = 2;

const PLATFORM: Record<string, string> = { x: "X", threads: "Threads", linkedin: "LinkedIn" };

function zoneOrUtc(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/** "X post goes out at 14:00. Edit or skip it before then." in the founder's time zone. */
export function autopilotLine(card: { platform: string | null; autoAt: string }, timezone: string): string {
  const zone = zoneOrUtc(timezone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(card.autoAt));
  const where = card.platform ? PLATFORM[card.platform.toLowerCase()] : undefined;
  return `${where ? `${where} post` : "A post"} goes out at ${time}. Edit or skip it before then.`;
}

export type AutopilotSoon = { approvalId: string; platform: string | null; autoAt: string };

/**
 * The founder's next autopilot post within the push window, read under their own session (RLS) for the service
 * worker, or with the service role and `userId` for the cron.
 */
export async function nextAutopilot(db: SupabaseClient, now: Date, userId?: string): Promise<AutopilotSoon | null> {
  let q = db
    .from("approvals")
    .select("id, snapshot, auto_at")
    .eq("status", "waiting")
    .eq("kind", "post")
    .gt("auto_at", now.toISOString())
    .lte("auto_at", new Date(now.getTime() + AUTOPILOT_PUSH_HOURS * 3_600_000).toISOString())
    .order("auto_at")
    .limit(1);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q.maybeSingle<{ id: string; snapshot: Record<string, unknown> | null; auto_at: string }>();
  if (error) throw new Error(`approvals: ${error.message}`);
  if (!data) return null;
  const platform = typeof data.snapshot?.platform === "string" ? data.snapshot.platform : null;
  return { approvalId: data.id, platform, autoAt: data.auto_at };
}

type DueCard = { id: string; user_id: string; snapshot: Record<string, unknown> | null; auto_at: string };

/**
 * The cron's autopilot round: for each post card autopilot will approve within two hours, one push to each of its
 * founder's browsers, claimed first (`email_log_claim` kind `push`: once per card, only while it waits) and recorded
 * after. A founder who paused autopilot, turned push off or has no browser gets nothing, and nothing is logged.
 * Returns the cards pushed.
 */
export async function pushAutopilotSoon(
  admin: SupabaseClient,
  vapid: Vapid,
  doFetch: typeof fetch = fetch,
  opts: { now?: Date; deadline?: number } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const { data, error } = await admin
    .from("approvals")
    .select("id, user_id, snapshot, auto_at")
    .eq("status", "waiting")
    .eq("kind", "post")
    .gt("auto_at", now.toISOString())
    .lte("auto_at", new Date(now.getTime() + AUTOPILOT_PUSH_HOURS * 3_600_000).toISOString())
    .order("auto_at")
    .limit(200);
  if (error) throw new Error(`approvals: ${error.message}`);
  const cards = (data ?? []) as DueCard[];
  if (!cards.length) return 0;
  const users = [...new Set(cards.map((c) => c.user_id))];
  const [profiles, settings, subs] = await Promise.all([
    admin.from("profiles").select("id, timezone, autopilot_paused").in("id", users),
    admin.from("notify_settings").select("user_id, push").in("user_id", users),
    admin.from("push_subscriptions").select("id, user_id, endpoint").in("user_id", users).order("failures"),
  ]);
  for (const r of [profiles, settings, subs]) if (r.error) throw new Error(`autopilot push: ${r.error.message}`);
  const profile = new Map(((profiles.data ?? []) as { id: string; timezone: string | null; autopilot_paused: boolean | null }[]).map((p) => [p.id, p]));
  const pushOff = new Set(((settings.data ?? []) as { user_id: string; push: boolean }[]).filter((s) => !s.push).map((s) => s.user_id));
  const browsers = new Map<string, { id: string; endpoint: string }[]>();
  for (const s of (subs.data ?? []) as { id: string; user_id: string; endpoint: string }[]) {
    if (!PUSH_HOSTS.test(s.endpoint)) continue;
    browsers.set(s.user_id, [...(browsers.get(s.user_id) ?? []), s]);
  }

  let pushed = 0;
  for (const card of cards) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    const p = profile.get(card.user_id);
    const targets = browsers.get(card.user_id) ?? [];
    // Paused from the top bar: nothing counts down, so nothing is about to go out.
    if (!p || p.autopilot_paused === true || pushOff.has(card.user_id) || !targets.length) continue;
    const line = autopilotLine({ platform: typeof card.snapshot?.platform === "string" ? card.snapshot.platform : null, autoAt: card.auto_at }, p.timezone ?? "UTC");
    try {
      const claimed = await admin.rpc("email_log_claim", { p_user: card.user_id, p_kind: "push", p_approval_ids: [card.id], p_subject: line, p_summary: { browsers: targets.length } });
      if (claimed.error) throw new Error(`email_log_claim: ${claimed.error.message}`);
      const log = ((claimed.data ?? []) as { log_id: string }[])[0];
      if (!log) continue;
      let accepted = 0;
      for (let i = 0; i < targets.length; i += PUSH_BATCH) {
        const statuses = await Promise.all(
          targets.slice(i, i + PUSH_BATCH).map(async (t) => {
            const status = await sendPush(vapid, t.endpoint, doFetch);
            const done = await admin.rpc("push_done", { p_subscription: t.id, p_status: status });
            if (done.error) console.warn("[notify] push_done", done.error.message);
            return status;
          }),
        );
        accepted += statuses.filter((s) => s >= 200 && s < 300).length;
      }
      await admin.rpc("email_log_done", {
        p_log: log.log_id,
        p_provider_id: accepted ? `push:${accepted}` : null,
        p_error: accepted ? null : "No browser accepted the push.",
      });
      if (accepted) pushed += 1;
    } catch (err) {
      console.warn("[notify] autopilot push", card.id, err instanceof Error ? err.message : err);
    }
  }
  return pushed;
}
