/**
 * Sending email (P6 C0, wave 2 B2) with the service role, from the hourly cron. Every send is claimed first in SQL
 * (`email_log_claim`: one digest a founder's local day, nothing once unsubscribed or switched off) and recorded after
 * (`email_log_done`), so a retry or a second cron run never sends twice. A morning with nothing new is logged as
 * `skipped` instead (`email_log_skip`), so Settings can say why no email came.
 *
 * Whatever can fail runs before the claim (the unsubscribe token) or inside `sendClaimed` (building the email), so a
 * claim is always recorded as sent or failed. A failed one frees its digest day for the next run. Only a process that
 * dies between the provider's answer and `email_log_done` leaves a claim open, which errs toward never sending twice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { DIGEST_SKIPPED_NOTE, buildDigest, cardTitle, digestDayAllowed, digestScheduleLabel, loadDigestInput, localClock, type DigestDays } from "@/lib/cmo/digest";

import { emailFooter, expiringEmail, unsubscribeUrl, type EmailSender } from "./email";

type Claim = { log_id: string; approval_ids: string[] };

async function claim(admin: SupabaseClient, userId: string, kind: "digest" | "expiring", ids: string[], log?: { subject: string; summary: Record<string, unknown> }): Promise<Claim | null> {
  const { data, error } = await admin.rpc("email_log_claim", {
    p_user: userId,
    p_kind: kind,
    p_approval_ids: ids,
    ...(log ? { p_subject: log.subject.slice(0, 200), p_summary: log.summary } : {}),
  });
  if (error) throw new Error(`email_log_claim: ${error.message}`);
  return ((data ?? []) as Claim[])[0] ?? null;
}

type NotifySettings = { unsubscribe_token: string; email_digest: boolean };

async function settingsFor(admin: SupabaseClient, userId: string): Promise<NotifySettings> {
  const { data, error } = await admin.rpc("notify_settings_for", { p_user: userId });
  if (error || !data) throw new Error(`notify_settings_for: ${error?.message ?? "missing"}`);
  return data as NotifySettings;
}

async function token(admin: SupabaseClient, userId: string): Promise<string> {
  return (await settingsFor(admin, userId)).unsubscribe_token;
}

/** How many hours after a founder's digest hour the cron still sends a digest not yet sent today (a failed send). */
export const DIGEST_CATCH_UP_HOURS = 3;

/**
 * Whether the cron sends the digest now: on a day `digest_days` allows (local weekday), at the digest hour or up to
 * two hours after it.
 */
export function digestDue(clock: { hour: number; weekday: number }, founder: { digest_hour: number | null; digest_days: DigestDays }): boolean {
  const h = founder.digest_hour;
  // The catch-up stops at local midnight: the claim is keyed on the local date, so a 23:00 digest caught up at 00:05
  // counted as the next day's, sent twice and then moved to midnight for good.
  return h !== null && digestDayAllowed(founder.digest_days, clock.weekday) && clock.hour >= h && clock.hour - h < DIGEST_CATCH_UP_HOURS;
}

async function sendClaimed(admin: SupabaseClient, sender: EmailSender, c: Claim, send: () => Promise<{ id: string }>): Promise<boolean> {
  try {
    const { id } = await send();
    await admin.rpc("email_log_done", { p_log: c.log_id, p_provider_id: id, p_error: null });
    return true;
  } catch (err) {
    const message = (err instanceof Error ? err.message : "send failed").slice(0, 500);
    await admin.rpc("email_log_done", { p_log: c.log_id, p_provider_id: null, p_error: message });
    console.warn(`[notify] ${sender.name}: not sent`, message);
    return false;
  }
}

export type Founder = { id: string; email: string | null; timezone: string; digest_hour: number | null; digest_days: DigestDays };

/** When this founder's last morning email went out: people found after it are new. Null before the first. */
async function lastDigestAt(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.from("email_log").select("sent_at").eq("user_id", userId).eq("kind", "digest").eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle<{ sent_at: string | null }>();
  if (error) throw new Error(`email_log: ${error.message}`);
  return data?.sent_at ?? null;
}

/** What the morning run did for one founder: sent, logged a day with nothing new, or nothing (off, already done). */
export type DigestOutcome = "sent" | "skipped" | "none";

/**
 * The morning digest for one founder whose digest is due (`digestDue`). A morning with nothing new is not sent: it is
 * logged as `skipped` (`email_log_skip`), which also holds the day, so the hour's later runs send nothing.
 */
export async function sendDigestEmail(admin: SupabaseClient, sender: EmailSender, founder: Founder, opts: { appUrl: string; now: Date }): Promise<DigestOutcome> {
  if (!founder.email || founder.digest_days === "off") return "none";
  const notify = await settingsFor(admin, founder.id);
  // Unsubscribed: no email and no skipped rows in a log the founder no longer reads.
  if (!notify.email_digest) return "none";
  const clock = localClock(opts.now, founder.timezone);
  const url = unsubscribeUrl(opts.appUrl, notify.unsubscribe_token);
  const input = await loadDigestInput(admin, founder.id, {
    appUrl: opts.appUrl,
    dateLabel: clock.dateLabel,
    now: opts.now,
    timezone: founder.timezone,
    since: await lastDigestAt(admin, founder.id),
    schedule: digestScheduleLabel(founder.digest_days, founder.digest_hour ?? 8),
    unsubscribeUrl: url,
  });
  const draft = buildDigest(input);
  if (draft.empty) {
    const { data, error } = await admin.rpc("email_log_skip", {
      p_user: founder.id,
      p_kind: "digest",
      p_summary: { ...draft.summary, note: DIGEST_SKIPPED_NOTE },
    });
    if (error) throw new Error(`email_log_skip: ${error.message}`);
    // Null: the day already has a row (sent, skipped or claimed).
    return data ? "skipped" : "none";
  }
  const c = await claim(admin, founder.id, "digest", input.waiting.map((w) => w.id), { subject: draft.subject, summary: draft.summary });
  if (!c) return "none";
  const ok = await sendClaimed(admin, sender, c, async () => {
    // Only the cards the claim kept (still waiting, the founder's own).
    const kept = new Set(c.approval_ids);
    const digest = buildDigest({ ...input, people: input.people.filter((p) => kept.has(p.approvalId)), posts: input.posts.firstId && !kept.has(input.posts.firstId) ? { ...input.posts, firstId: null } : input.posts });
    return sender.send({ to: founder.email!, subject: digest.subject, text: digest.text, html: digest.html, unsubscribeUrl: url });
  });
  return ok ? "sent" : "none";
}

/** Time-bound cards (schedule cards) expiring in the next two hours get one email each. */
/**
 * `deadline` (ms since epoch): no new card is claimed after it, so a slow provider cannot run the cron past its limit
 * with a claim left open (an open claim reads as sent, and that card would never get its email).
 */
export async function sendExpiringEmails(admin: SupabaseClient, sender: EmailSender, opts: { appUrl: string; now: Date; deadline?: number }): Promise<number> {
  const from = new Date(opts.now.getTime() + 15 * 60_000).toISOString();
  const to = new Date(opts.now.getTime() + 2 * 3_600_000).toISOString();
  const { data, error } = await admin
    .from("approvals")
    .select("id, user_id, kind, snapshot, expires_at")
    .eq("status", "waiting")
    .gte("expires_at", from)
    .lte("expires_at", to)
    .order("expires_at")
    .limit(200);
  if (error) throw new Error(`approvals: ${error.message}`);
  const cards = (data ?? []) as { id: string; user_id: string; kind: string; snapshot: Record<string, unknown>; expires_at: string }[];
  if (!cards.length) return 0;
  const { data: founders, error: fErr } = await admin.from("profiles").select("id, email, timezone").in("id", [...new Set(cards.map((c) => c.user_id))]);
  if (fErr) throw new Error(`profiles: ${fErr.message}`);
  const byId = new Map(((founders ?? []) as { id: string; email: string | null; timezone: string }[]).map((f) => [f.id, f]));
  let sent = 0;
  const tokens = new Map<string, string>();
  for (const card of cards) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    const founder = byId.get(card.user_id);
    if (!founder?.email) continue;
    try {
      if (!tokens.has(founder.id)) tokens.set(founder.id, await token(admin, founder.id));
      const url = unsubscribeUrl(opts.appUrl, tokens.get(founder.id)!);
      const c = await claim(admin, founder.id, "expiring", [card.id]);
      if (!c) continue;
      const ok = await sendClaimed(admin, sender, c, async () => {
        const message = expiringEmail({ appUrl: opts.appUrl, cardId: card.id, title: cardTitle(card.snapshot), expiresAt: card.expires_at, timezone: founder.timezone, unsubscribeUrl: url });
        return sender.send({ to: founder.email!, ...message });
      });
      if (ok) sent += 1;
    } catch (err) {
      console.warn("[notify] expiring email", card.id, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}
