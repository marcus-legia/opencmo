import "server-only";

/**
 * Reads what `buildToday` needs for one founder (CMO review 3, 1.1). One reader for the Dashboard (the founder's
 * session, under RLS) and the morning email (the service role), so both show the same rows. Every query names the
 * user explicitly: under the service role RLS does not narrow anything.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { publishAdapter } from "@/lib/departments/publish/adapter";
import { DEPARTMENTS, type Department } from "@/lib/screens/common";
import { localDay, localMidnight } from "@/lib/time-zone";

import { cardTitle } from "./digest";
import { safeZone, todayPlatform, type TodayCard, type TodayFailedSlot, type TodayInput, type TodayPlatform } from "./today";

/** How far back "the last post per platform" looks: a platform quiet for longer than this is not nagged about. */
const SILENCE_LOOKBACK_DAYS = 60;

/** Whether posting from OpenCMO is set up on this server; without it, posting by intent needs no account. */
export function publishConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try {
    publishAdapter(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Session A's `rateDraftsPending(supabase)` (`lib/cmo/voice.ts`, A5) answers the "Rate your first drafts" row. Until
 * it lands this is false, and the row never shows.
 */
async function rateDraftsPending(_db: SupabaseClient, _userId: string): Promise<boolean> {
  return false;
}

const department = (value: string): Department => ((DEPARTMENTS as readonly string[]).includes(value) ? (value as Department) : "brain");

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`today ${what}: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

type CardDb = { id: string; kind: string; department: string; snapshot: Record<string, unknown>; created_at: string; expires_at: string | null };
type SlotDb = { id: string; platform: string; publish_at: string; approval_id: string | null };

/**
 * `asService`: the caller holds the service role (the email cron). It reads published posts through
 * `published_items(user, since)`; the founder's session reads its own through `my_published_items(since)`.
 */
export async function loadTodayInput(
  db: SupabaseClient,
  userId: string,
  opts: { now: Date; timezone: string; asService?: boolean; env?: Record<string, string | undefined> },
): Promise<TodayInput> {
  const { now } = opts;
  const timezone = safeZone(opts.timezone);
  const today = localDay(now, timezone);
  const dayAfter = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const midnight = (day: string) => localMidnight(day, timezone) ?? `${day}T00:00:00Z`;
  const startOfToday = midnight(today);
  const startOfTomorrow = midnight(dayAfter(today, 1));
  const startOfDayAfter = midnight(dayAfter(today, 2));
  const since = new Date(now.getTime() - SILENCE_LOOKBACK_DAYS * 86_400_000).toISOString();
  const publishing = publishConfigured(opts.env);

  const [waiting, decidedToday, decidedEver, strategy, failed, published, tomorrow, accounts, rate, coming] = await Promise.all([
    db.from("approvals").select("id, kind, department, snapshot, created_at, expires_at").eq("user_id", userId).eq("status", "waiting")
      .order("created_at").limit(100),
    // The rows, not a count: a time approved with its post is a `schedule` card that was born decided, and counting
    // it made one Approve read "2 done".
    db.from("approvals").select("id, created_at, decided_at").eq("user_id", userId)
      .in("status", ["approved", "edited", "skipped"]).gte("decided_at", startOfToday).limit(500),
    db.from("approvals").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["approved", "edited", "skipped"]),
    db.from("marketing_documents").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "strategy"),
    // A failed post still inside its window, with its Retry card waiting.
    db.from("schedule_slots").select("id, platform, publish_at, approval_id").eq("user_id", userId).eq("status", "failed")
      .gt("window_ends_at", now.toISOString()).not("approval_id", "is", null).limit(20),
    opts.asService
      ? db.rpc("published_items", { p_user: userId, p_since: since })
      : db.rpc("my_published_items", { p_since: since }),
    // Only a slot meant to publish needs an account; an intent slot (no account) still reminds the founder to post.
    publishing
      ? db.from("schedule_slots").select("platform").eq("user_id", userId).eq("mode", "publish").in("status", ["proposed", "waiting"])
          .gte("publish_at", startOfTomorrow).lt("publish_at", startOfDayAfter).limit(50)
      : Promise.resolve({ data: [], error: null }),
    publishing
      ? db.from("social_accounts").select("platform").eq("user_id", userId).eq("status", "connected")
      : Promise.resolve({ data: [], error: null }),
    rateDraftsPending(db, userId),
    // A post already on its way (now to the end of tomorrow): its platform is not silent.
    db.from("schedule_slots").select("platform").eq("user_id", userId).in("status", ["proposed", "waiting", "due", "reminded", "publishing"])
      .gte("publish_at", now.toISOString()).lt("publish_at", startOfDayAfter).limit(50),
  ]);

  const cardRows = check(waiting, "approvals") as CardDb[];
  const cards: TodayCard[] = cardRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    department: department(row.department),
    title: cardTitle(row.snapshot),
    platform: todayPlatform(row.snapshot.platform),
    raisedAt: new Date(row.created_at).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  }));
  const titles = new Map(cards.map((card) => [card.id, card.title]));

  for (const r of [decidedToday, decidedEver, strategy]) if (r.error) throw new Error(`today counts: ${r.error.message}`);

  const failedSlots: TodayFailedSlot[] = (check(failed, "slots") as SlotDb[]).flatMap((slot) => {
    const platform = todayPlatform(slot.platform);
    if (!platform || !slot.approval_id) return [];
    return [{ id: slot.id, platform, title: titles.get(slot.approval_id) ?? "Post", at: new Date(slot.publish_at).toISOString(), approvalId: slot.approval_id }];
  });

  const last = new Map<TodayPlatform, string>();
  for (const row of check(published, "published") as { platform: string; published_at: string }[]) {
    const platform = todayPlatform(row.platform);
    if (!platform || !row.published_at) continue;
    const at = new Date(row.published_at).toISOString();
    if ((last.get(platform) ?? "") < at) last.set(platform, at);
  }

  const connected = new Set((check(accounts, "accounts") as { platform: string }[]).map((a) => todayPlatform(a.platform)));
  const needsAccount = [
    ...new Set(
      (check(tomorrow, "tomorrow") as { platform: string }[]).flatMap((slot) => {
        const platform = todayPlatform(slot.platform);
        return platform && !connected.has(platform) ? [platform] : [];
      }),
    ),
  ];

  return {
    now,
    timezone,
    cards,
    decidedToday: ((decidedToday.data ?? []) as { created_at: string; decided_at: string | null }[]).filter((row) => row.decided_at !== row.created_at).length,
    failedSlots,
    lastPosted: [...last.entries()].map(([platform, at]) => ({ platform, at })),
    needsAccount,
    upcoming: [...new Set((check(coming, "upcoming") as { platform: string }[]).flatMap((slot) => todayPlatform(slot.platform) ?? []))],
    firstRun: { readStrategy: (strategy.count ?? 0) > 0 && (decidedEver.count ?? 0) === 0, rateDrafts: rate },
  };
}
