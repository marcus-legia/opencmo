/**
 * The morning digest (docs/architecture/approval.md §7; brain plan W1-4): what waits on the founder, what went out,
 * what is stuck. A template, no model call. Links open the card at `/app/inbox/[id]`; the digest never decides
 * anything (mail scanners open links), so there is no approve button in it.
 *
 * Wave 1 shows it on the Dashboard and sends it locally through `sendDigest` (the local stack's mail catcher).
 * There is no email provider in production yet (approval phase A2), so `digestSender()` is null there.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isProduction } from "@/lib/production";

export type DigestInput = {
  /** Absolute origin of the app, for links in the email (`https://opencmo.io`). */
  appUrl: string;
  /** The founder's local date, already formatted ("Thursday 29 Oct"). */
  dateLabel: string;
  waiting: { id: string; title: string; department: string }[];
  wentOut: { title: string; where: string }[];
  stuck: { title: string; department: string; reason: string }[];
};

export type Digest = { subject: string; text: string; html: string; empty: boolean };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function buildDigest(input: DigestInput): Digest {
  const { waiting, wentOut, stuck } = input;
  const empty = waiting.length === 0 && wentOut.length === 0 && stuck.length === 0;
  const subject = waiting.length
    ? `${plural(waiting.length, "thing waits", "things wait")} on you · ${input.dateLabel}`
    : `Your CMO this morning · ${input.dateLabel}`;
  const link = (id: string) => `${input.appUrl.replace(/\/$/, "")}/app/inbox/${encodeURIComponent(id)}`;

  const text = [
    subject,
    "",
    waiting.length ? "Waiting on you:" : "Nothing waits on you.",
    ...waiting.map((w) => `- ${cap(w.department)}: ${w.title}\n  ${link(w.id)}`),
    ...(wentOut.length ? ["", "Went out:", ...wentOut.map((o) => `- ${o.where}: ${o.title}`)] : []),
    ...(stuck.length ? ["", "Stuck:", ...stuck.map((s) => `- ${cap(s.department)}: ${s.title}. ${s.reason}`)] : []),
    "",
    "Open a card to decide it in the app. Nothing goes out until you approve it.",
  ].join("\n");

  const section = (title: string, items: string[]) =>
    items.length ? `<h2 style="font:600 14px Inter,sans-serif;margin:20px 0 8px">${escapeHtml(title)}</h2><ul style="padding-left:18px;margin:0">${items.join("")}</ul>` : "";
  const html = [
    `<div style="font:14px/1.5 Inter,sans-serif;color:#2b2723;max-width:560px">`,
    `<h1 style="font:600 18px Inter,sans-serif;margin:0 0 8px">${escapeHtml(subject)}</h1>`,
    waiting.length ? "" : `<p>Nothing waits on you.</p>`,
    section(
      "Waiting on you",
      waiting.map((w) => `<li><a href="${escapeHtml(link(w.id))}" style="color:#c93a0f">${escapeHtml(cap(w.department))}: ${escapeHtml(w.title)}</a></li>`),
    ),
    section("Went out", wentOut.map((o) => `<li>${escapeHtml(o.where)}: ${escapeHtml(o.title)}</li>`)),
    section("Stuck", stuck.map((s) => `<li>${escapeHtml(cap(s.department))}: ${escapeHtml(s.title)}. ${escapeHtml(s.reason)}</li>`)),
    `<p style="color:#69695d;margin-top:20px">Open a card to decide it in the app. Nothing goes out until you approve it.</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html, empty };
}

/** Reads one founder's digest content. Works with the founder's session (RLS) or the service role. */
export async function loadDigestInput(
  db: SupabaseClient,
  userId: string,
  opts: { appUrl: string; dateLabel: string; now?: Date },
): Promise<DigestInput> {
  const since = new Date((opts.now ?? new Date()).getTime() - 24 * 3_600_000).toISOString();
  const [waiting, out, stuck] = await Promise.all([
    db.from("approvals").select("id, kind, department, snapshot").eq("user_id", userId).eq("status", "waiting").order("created_at").limit(20),
    db.from("content_items").select("idea, platform, final_text").eq("user_id", userId).eq("status", "published").gte("published_at", since).limit(20),
    db.from("work_orders").select("title, department, error").eq("user_id", userId).eq("status", "failed").gte("updated_at", since).limit(20),
  ]);
  for (const r of [waiting, out, stuck]) if (r.error) throw new Error(`digest: ${r.error.message}`);
  const title = (row: { kind: string; snapshot: Record<string, unknown> }) => {
    const s = row.snapshot;
    const pick = s.kind === "post" ? s.text : s.kind === "reply" ? s.title : s.kind === "goal" ? s.goal : s.rule;
    return (typeof pick === "string" && pick ? pick : row.kind).slice(0, 120);
  };
  return {
    appUrl: opts.appUrl,
    dateLabel: opts.dateLabel,
    waiting: ((waiting.data ?? []) as { id: string; kind: string; department: string; snapshot: Record<string, unknown> }[]).map((r) => ({
      id: r.id,
      title: title(r),
      department: r.department,
    })),
    wentOut: ((out.data ?? []) as { idea: string; platform: string; final_text: string | null }[]).map((r) => ({
      title: (r.final_text ?? r.idea).slice(0, 120),
      where: r.platform.toUpperCase() === "X" ? "X" : r.platform,
    })),
    stuck: ((stuck.data ?? []) as { title: string; department: string; error: { message?: string } | null }[]).map((r) => ({
      title: r.title,
      department: r.department,
      reason: r.error?.message ?? "It failed.",
    })),
  };
}

export type DigestSender = (to: string, digest: Digest) => Promise<void>;

/**
 * Where digests go. Locally (`OPENCMO_DIGEST_LOCAL_MAIL=1`) they land in the local stack's mail catcher through its
 * HTTP send API, at `OPENCMO_LOCAL_MAIL_URL` (default the Supabase CLI's 54324). Production has no sender until an
 * email provider is chosen (A2), so the digest is only in the app there.
 */
export function digestSender(): DigestSender | null {
  if (isProduction() || process.env.OPENCMO_DIGEST_LOCAL_MAIL !== "1") return null;
  const base = (process.env.OPENCMO_LOCAL_MAIL_URL ?? "http://127.0.0.1:54324").replace(/\/$/, "");
  return async (to, digest) => {
    const response = await fetch(`${base}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: "cmo@opencmo.local", Name: "Your CMO" },
        To: [{ Email: to }],
        Subject: digest.subject,
        Text: digest.text,
        HTML: digest.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`local mail answered ${response.status}`);
  };
}

/** The founder's local hour and date label in their time zone (an unknown zone falls back to UTC). */
export function localClock(now: Date, timezone: string): { hour: number; dateLabel: string } {
  const zone = (() => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
      return timezone;
    } catch {
      return "UTC";
    }
  })();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "short" }).format(now);
  return { hour, dateLabel };
}
