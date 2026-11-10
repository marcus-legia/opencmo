/**
 * The morning digest (docs/architecture/approval.md §7; brain plan W1-4): what waits on the founder, what went out,
 * what is stuck. A template, no model call. Links open the card at `/app/inbox/[id]`; the digest never decides
 * anything (mail scanners open links), so there is no approve button in it.
 *
 * The Dashboard shows it; `lib/notify/send.ts` emails it (P6 C0) with an unsubscribe footer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildToday, type TodayRow } from "./today";

/** How many Today rows the email carries; the rest are "N more waiting" (CMO review 3, 1.3). */
export const DIGEST_TODAY_ROWS = 3;

export type DigestInput = {
  /** Absolute origin of the app, for links in the email (`https://opencmo.io`). */
  appUrl: string;
  /** The founder's local date, already formatted ("Thursday 29 Oct"). */
  dateLabel: string;
  waiting: { id: string; title: string; department: string }[];
  wentOut: { title: string; where: string }[];
  stuck: { title: string; department: string; reason: string }[];
  /**
   * The Dashboard's Today rows (`buildToday`), most urgent first, and how many rows are open in all. When there are
   * rows, the email starts with the top three and "N more waiting" instead of the whole waiting list.
   */
  today?: { rows: TodayRow[]; open: number };
};

export type Digest = { subject: string; text: string; html: string; empty: boolean };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The one HTML escaper of every email (the digest body here, the footer in `lib/notify/email.ts`). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Where a Today row's link goes in the email. Links only open things (mail scanners open links): a card opens in the
 * inbox, a page opens as it is, and a chat request opens the Dashboard's chat, where the founder sends it themselves.
 */
function todayHref(row: TodayRow): string {
  if (row.action.type === "card") return `/app/inbox/${encodeURIComponent(row.action.approvalId)}`;
  if (row.action.type === "link") return row.action.href;
  return "/app?ask=1";
}

export function buildDigest(input: DigestInput): Digest {
  const { waiting, wentOut, stuck } = input;
  const base = input.appUrl.replace(/\/$/, "");
  const todayRows = (input.today?.rows ?? []).slice(0, DIGEST_TODAY_ROWS);
  const more = Math.max(0, (input.today?.open ?? 0) - todayRows.length);
  const empty = waiting.length === 0 && wentOut.length === 0 && stuck.length === 0 && todayRows.length === 0;
  const subject = waiting.length
    ? `${plural(waiting.length, "thing waits", "things wait")} on you · ${input.dateLabel}`
    : `Your CMO this morning · ${input.dateLabel}`;
  const link = (id: string) => `${base}/app/inbox/${encodeURIComponent(id)}`;
  const rowLink = (row: TodayRow) => `${base}${todayHref(row)}`;
  const moreLine = more > 0 ? `${more} more waiting` : null;

  const text = [
    subject,
    "",
    ...(todayRows.length
      ? [
          "Today:",
          ...todayRows.map((row) => `- ${row.title}\n  ${rowLink(row)}`),
          ...(moreLine ? [`${moreLine}: ${base}/app`] : []),
        ]
      : [waiting.length ? "Waiting on you:" : "Nothing waits on you.", ...waiting.map((w) => `- ${cap(w.department)}: ${w.title}\n  ${link(w.id)}`)]),
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
    todayRows.length
      ? section("Today", todayRows.map((row) => `<li><a href="${escapeHtml(rowLink(row))}" style="color:#c93a0f">${escapeHtml(row.title)}</a></li>`)) +
        (moreLine ? `<p style="margin:8px 0 0"><a href="${escapeHtml(`${base}/app`)}" style="color:#69695d">${escapeHtml(moreLine)}</a></p>` : "")
      : (waiting.length ? "" : `<p>Nothing waits on you.</p>`) +
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
/**
 * What a card is, in one line of at most 120 characters: the digest and the expiring-card email both name cards with
 * it (review follow-up S3). One line, because a post's own newlines would land in an email's Subject header.
 */
export function cardTitle(snapshot: Record<string, unknown>): string {
  const s = snapshot;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  // Every kind names itself differently; a schedule card says what goes out and where.
  const pick =
    s.kind === "post" ? str(s.text)
    : s.kind === "reply" ? str(s.title)
    : s.kind === "goal" ? str(s.goal)
    : s.kind === "correction" ? str(s.rule)
    : s.kind === "schedule" ? [str(s.text) ?? str(s.title) ?? "A post", str(s.platform) ? (String(s.platform) === "x" ? "X" : String(s.platform)) : null].filter(Boolean).join(" · ")
    : (str(s.title) ?? str(s.text));
  return (pick ?? "A card waits for you").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * `today: false` skips the Today rows (the Dashboard has its own block). The rows read published posts through
 * `my_published_items` under the founder's session and `published_items` under the service role; `asService`
 * says which, and without it the founder's session is tried first.
 */
export async function loadDigestInput(
  db: SupabaseClient,
  userId: string,
  opts: { appUrl: string; dateLabel: string; now?: Date; today?: boolean; timezone?: string; asService?: boolean },
): Promise<DigestInput> {
  const since = new Date((opts.now ?? new Date()).getTime() - 24 * 3_600_000).toISOString();
  const [waiting, out, stuck] = await Promise.all([
    db.from("approvals").select("id, kind, department, snapshot").eq("user_id", userId).eq("status", "waiting").order("created_at").limit(20),
    db.from("content_items").select("idea, platform, final_text").eq("user_id", userId).eq("status", "published").gte("published_at", since).limit(20),
    db.from("work_orders").select("title, department, error").eq("user_id", userId).eq("status", "failed").gte("updated_at", since).limit(20),
  ]);
  for (const r of [waiting, out, stuck]) if (r.error) throw new Error(`digest: ${r.error.message}`);
  const today = opts.today === false ? undefined : await digestToday(db, userId, opts);
  return {
    ...(today ? { today } : {}),
    appUrl: opts.appUrl,
    dateLabel: opts.dateLabel,
    waiting: ((waiting.data ?? []) as { id: string; kind: string; department: string; snapshot: Record<string, unknown> }[]).map((r) => ({
      id: r.id,
      title: cardTitle(r.snapshot),
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

/** Today's rows for the email: the same `buildToday` the Dashboard runs. A failure leaves the email as it was. */
async function digestToday(
  db: SupabaseClient,
  userId: string,
  opts: { now?: Date; timezone?: string; asService?: boolean },
): Promise<DigestInput["today"]> {
  try {
    // Loaded here, not at the top: the reader is server-only, and this module is also used by pure checks.
    const { loadTodayInput } = await import("./today-input");
    const now = opts.now ?? new Date();
    let timezone = opts.timezone;
    if (!timezone) {
      const { data } = await db.from("profiles").select("timezone").eq("id", userId).maybeSingle<{ timezone: string | null }>();
      timezone = data?.timezone || "UTC";
    }
    const read = (asService: boolean) => loadTodayInput(db, userId, { now, timezone: timezone!, asService });
    const input = opts.asService !== undefined ? await read(opts.asService) : await read(false).catch(() => read(true));
    const today = buildToday(input);
    return { rows: today.rows, open: today.total - today.done };
  } catch (error) {
    console.warn("[digest] Today rows not read", error instanceof Error ? error.message : error);
    return undefined;
  }
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
