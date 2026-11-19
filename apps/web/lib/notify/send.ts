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

import { DIGEST_SKIPPED_NOTE, buildDigest, digestDayAllowed, digestScheduleLabel, loadDigestInput, localClock, type DigestDays } from "@/lib/cmo/digest";
import { buildWeekly, loadWeeklyInput } from "@/lib/cmo/weekly-report";

import { unsubscribeUrl, type EmailSender } from "./email";

type Claim = { log_id: string; approval_ids: string[] };

async function claim(admin: SupabaseClient, userId: string, kind: "digest" | "weekly", ids: string[], log?: { subject: string; summary: Record<string, unknown> }): Promise<Claim | null> {
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
  // Wave 3 B8: on Mondays the weekly report replaces the morning email.
  if (clock.weekday === 1) return sendWeekly(admin, sender, founder, { ...opts, dateLabel: clock.dateLabel, unsubscribeUrl: url });
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
  // `email_log_claim` keeps at most 50 ids, the oldest first: send the ones the email is about first, so a founder
  // with a long queue never gets an email that lost its newest people (review of #238).
  const ids = [...new Set([...input.people.map((p) => p.approvalId), ...(input.posts.firstId ? [input.posts.firstId] : []), ...input.waiting.map((w) => w.id)])].slice(0, 50);
  const c = await claim(admin, founder.id, "digest", ids, { subject: draft.subject, summary: draft.summary });
  if (!c) return "none";
  const ok = await sendClaimed(admin, sender, c, async () => {
    // Only the cards the claim kept (still waiting, the founder's own).
    const kept = new Set(c.approval_ids);
    const digest = buildDigest({ ...input, people: input.people.filter((p) => kept.has(p.approvalId)), posts: input.posts.firstId && !kept.has(input.posts.firstId) ? { ...input.posts, firstId: null } : input.posts });
    return sender.send({ to: founder.email!, subject: digest.subject, text: digest.text, html: digest.html, unsubscribeUrl: url });
  });
  return ok ? "sent" : "none";
}

/** What a skipped Monday's log row says. */
export const WEEKLY_SKIPPED_NOTE = "Nothing this week: no one found, no reply and no post";

/**
 * The weekly report for one founder (wave 3 B8), in place of Monday's morning email: claimed as `weekly` (one a local
 * day, nothing once unsubscribed), sent, and recorded. A week with nothing in it is logged as skipped, not sent.
 */
async function sendWeekly(
  admin: SupabaseClient,
  sender: EmailSender,
  founder: Founder,
  opts: { appUrl: string; now: Date; dateLabel: string; unsubscribeUrl: string },
): Promise<DigestOutcome> {
  const input = await loadWeeklyInput(admin, founder.id, {
    appUrl: opts.appUrl,
    dateLabel: opts.dateLabel,
    now: opts.now,
    schedule: digestScheduleLabel(founder.digest_days, founder.digest_hour ?? 8),
    unsubscribeUrl: opts.unsubscribeUrl,
  });
  const report = buildWeekly(input);
  if (report.empty) {
    const { data, error } = await admin.rpc("email_log_skip", { p_user: founder.id, p_kind: "weekly", p_summary: { ...report.summary, note: WEEKLY_SKIPPED_NOTE } });
    if (error) throw new Error(`email_log_skip: ${error.message}`);
    return data ? "skipped" : "none";
  }
  const c = await claim(admin, founder.id, "weekly", [], { subject: report.subject, summary: report.summary });
  if (!c) return "none";
  const ok = await sendClaimed(admin, sender, c, () =>
    sender.send({ to: founder.email!, subject: report.subject, text: report.text, html: report.html, unsubscribeUrl: opts.unsubscribeUrl }),
  );
  return ok ? "sent" : "none";
}
