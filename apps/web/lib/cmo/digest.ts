/**
 * The morning email (wave 2, B1; `docs/plans/cmo/2026-11-19-wave2-plan.md` §4): people asking first, then the
 * founder's replies someone answered, then one line for posts. A template, no model call. Links only open things
 * behind login (mail scanners open links), so nothing in it decides.
 *
 * `lib/notify/send.ts` emails it. The Dashboard reads `waiting`, `wentOut` and `stuck` from the same loader; the email
 * itself no longer shows what went out or what is stuck (the founder acts on people, not on our job log).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { PLATFORM_LABEL, SALES_PLATFORMS } from "./social/conversations";

/** People rows in the email, strongest first. */
export const DIGEST_PEOPLE = 3;
/** Follow-up rows in the email. */
export const DIGEST_FOLLOW_UPS = 2;
/** The Sales screen's line between Strong and Good match (`components/today/AgentSales.tsx`). */
export const STRONG_MATCH = 75;

/** A person asking: an open reply card. */
export type DigestPerson = {
  approvalId: string;
  /** The thread's title. */
  title: string;
  /** Where: "r/SaaS", "Hacker News". */
  source: string;
  score: number;
  /** Their own words (the Pain or Evidence quote the scan kept), without quote marks. */
  quote: string | null;
  /** Found since the last morning email. */
  isNew: boolean;
};

/** One of the founder's replies that someone answered (`reply-outcomes`). */
export type DigestFollowUp = { title: string; source: string; replies: number; url: string };

export type DigestPosts = {
  /** Post and schedule cards that wait. */
  waiting: number;
  /** The card the line links to: the one with the nearest deadline. */
  firstId: string | null;
  /** The nearest time something happens to a waiting post (ISO): it expires, or autopilot posts it. */
  nextAt: string | null;
  /** That time is autopilot's: the post goes out on its own unless edited or skipped. */
  autopilot: boolean;
  /** Where the autopilot post goes ("X"), for the line. */
  platform: string | null;
};

export type DigestInput = {
  /** Absolute origin of the app, for links in the email (`https://ferreto.io`). */
  appUrl: string;
  /** The founder's local date, already formatted ("Thursday 29 Oct"). */
  dateLabel: string;
  /** The founder's time zone, for times in the email. */
  timezone: string;
  now: Date;
  people: DigestPerson[];
  followUps: DigestFollowUp[];
  posts: DigestPosts;
  /** "every weekday at 08:00" (`digestScheduleLabel`). */
  schedule: string;
  /** The page that asks before unsubscribing; without it the footer points at Settings. */
  unsubscribeUrl?: string;
  /** Every waiting card, for the send's claim and the Dashboard. */
  waiting: { id: string; title: string; department: string }[];
  /** The Dashboard's: posts published in the last day. Not in the email. */
  wentOut: { title: string; where: string }[];
  /** The Dashboard's: work that failed in the last day. Not in the email. */
  stuck: { title: string; department: string; reason: string }[];
};

export type Digest = {
  subject: string;
  /** The inbox preview line: the strongest quote, or what the email is about. */
  preview: string;
  text: string;
  html: string;
  /** No new person, no follow-up and no post due today: the email is not sent. */
  empty: boolean;
  summary: { people: number; followUps: number; posts: number };
};

export type DigestDays = "weekdays" | "daily" | "monday" | "off";

export function digestScheduleLabel(days: DigestDays, hour: number): string {
  const at = `${String(hour).padStart(2, "0")}:00`;
  if (days === "weekdays") return `every weekday at ${at}`;
  if (days === "monday") return `every Monday at ${at}`;
  return `every morning at ${at}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The one HTML escaper of every email (the digest here, the footer in `lib/notify/email.ts`). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const matchLabel = (score: number) => (score >= STRONG_MATCH ? "Strong match" : "Good match");

/** Sources in the order they first appear, joined for a sentence: "r/SaaS, r/startups and Hacker News". */
function sourceList(sources: string[]): string {
  const unique = [...new Set(sources)].slice(0, 3);
  return unique.length <= 1 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

function clockIn(iso: string, timezone: string, now: Date): { time: string; today: boolean } {
  const zone = (() => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
      return timezone;
    } catch {
      return "UTC";
    }
  })();
  const at = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const today = day(at) === day(now);
  return { time: today ? time : `${new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short" }).format(at)} ${time}`, today };
}

export function buildDigest(input: DigestInput): Digest {
  const base = input.appUrl.replace(/\/$/, "");
  const card = (id: string) => `${base}/app/inbox/${encodeURIComponent(id)}`;
  const people = [...input.people].sort((a, b) => b.score - a.score).slice(0, DIGEST_PEOPLE);
  const fresh = input.people.filter((p) => p.isNew);
  const followUps = input.followUps.slice(0, DIGEST_FOLLOW_UPS);
  const { posts } = input;
  const next = posts.nextAt ? clockIn(posts.nextAt, input.timezone, input.now) : null;
  const postDueToday = posts.waiting > 0 && next?.today === true;
  const empty = fresh.length === 0 && followUps.length === 0 && !postDueToday;

  const postsLine =
    posts.waiting === 0
      ? null
      : `${plural(posts.waiting, "post waits", "posts wait")} for you.` +
        (next
          ? posts.autopilot
            ? ` ${posts.platform ? `The ${posts.platform} post` : "The next one"} goes out at ${next.time} unless you edit or skip it.`
            : ` The next one needs your OK by ${next.time}.`
          : "");

  const subject = (
    fresh.length
      ? `${plural(fresh.length, "person is", "people are")} asking on ${sourceList(fresh.map((p) => p.source))}`
      : followUps.length
        ? `Someone answered your reply on ${followUps[0]!.source}`
        : posts.waiting
          ? `${plural(posts.waiting, "post waits", "posts wait")} for you`
          : `Nothing new this morning`
  ).slice(0, 150);
  const strongest = [...fresh].sort((a, b) => b.score - a.score).find((p) => p.quote) ?? people.find((p) => p.quote);
  const preview = (strongest?.quote ? `“${strongest.quote}”` : (postsLine ?? input.dateLabel)).slice(0, 160);

  const settingsUrl = `${base}/app/settings#notifications`;
  const stopUrl = input.unsubscribeUrl ?? settingsUrl;
  const footerLines = [
    "Replies are never posted for you. You post them yourself, from your own account.",
    `You get this email ${input.schedule}.`,
  ];

  const text = [
    preview,
    "",
    ...(people.length
      ? [
          "PEOPLE ASKING",
          ...people.flatMap((p) => [
            `- ${p.source} · ${matchLabel(p.score)}${p.isNew ? " · new" : ""}`,
            `  ${p.title}`,
            ...(p.quote ? [`  “${p.quote}”`] : []),
            `  ${card(p.approvalId)}`,
          ]),
          ...(input.people.length > people.length ? [`${input.people.length - people.length} more in Sales: ${base}/app/sales`] : []),
          "",
        ]
      : []),
    ...(followUps.length
      ? [
          "FOLLOW UP",
          ...followUps.flatMap((f) => [`- ${plural(f.replies, "reply", "replies")} to your answer on ${f.source}`, `  ${f.title}`, `  ${f.url}`]),
          "",
        ]
      : []),
    ...(postsLine ? ["POSTS", `${postsLine} ${posts.firstId ? card(posts.firstId) : `${base}/app/post`}`, ""] : []),
    "--",
    ...footerLines,
    `Change when it comes: ${settingsUrl}`,
    `Stop these emails: ${stopUrl}`,
    `Questions: ${SUPPORT}`,
  ].join("\n");

  const muted = "#69695d";
  const accent = "#c93a0f";
  const h2 = (t: string) => `<h2 style="font:600 12px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${muted};margin:24px 0 8px">${escapeHtml(t)}</h2>`;
  const a = (href: string, label: string, color = accent) => `<a href="${escapeHtml(href)}" style="color:${color}">${escapeHtml(label)}</a>`;
  const html = [
    `<div style="font:14px/1.5 Inter,sans-serif;color:#2b2723;max-width:560px">`,
    // The preheader: mail clients show it after the subject; hidden in the body.
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div>`,
    `<h1 style="font:600 18px Inter,sans-serif;margin:0 0 4px">${escapeHtml(subject)}</h1>`,
    `<p style="color:${muted};margin:0">${escapeHtml(input.dateLabel)}</p>`,
    people.length
      ? h2("People asking") +
        people
          .map(
            (p) =>
              `<div style="margin:0 0 14px">` +
              `<div style="color:${muted};font-size:12px">${escapeHtml(p.source)} · ${escapeHtml(matchLabel(p.score))}${p.isNew ? " · new" : ""}</div>` +
              `<div>${a(card(p.approvalId), p.title)}</div>` +
              (p.quote ? `<div style="border-left:2px solid #e3e1da;padding-left:10px;margin-top:4px">“${escapeHtml(p.quote)}”</div>` : "") +
              `</div>`,
          )
          .join("") +
        (input.people.length > people.length ? `<p style="margin:0">${a(`${base}/app/sales`, `${input.people.length - people.length} more in Sales`, muted)}</p>` : "")
      : "",
    followUps.length
      ? h2("Follow up") +
        followUps
          .map(
            (f) =>
              `<div style="margin:0 0 14px"><div style="color:${muted};font-size:12px">${escapeHtml(plural(f.replies, "reply", "replies"))} to your answer on ${escapeHtml(f.source)}</div>` +
              `<div>${a(f.url, f.title)}</div></div>`,
          )
          .join("")
      : "",
    postsLine ? h2("Posts") + `<p style="margin:0">${a(posts.firstId ? card(posts.firstId) : `${base}/app/post`, postsLine, "#2b2723")}</p>` : "",
    `<p style="font:12px/1.5 Inter,sans-serif;color:${muted};margin-top:28px;border-top:1px solid #e3e1da;padding-top:12px">` +
      footerLines.map(escapeHtml).join(" ") +
      ` ${a(settingsUrl, "Change when it comes", muted)} · ${a(stopUrl, "Stop these emails", muted)} · ${a(`mailto:${SUPPORT}`, SUPPORT, muted)}</p>`,
    `</div>`,
  ].join("");
  return { subject, preview, text, html, empty, summary: { people: people.length, followUps: followUps.length, posts: posts.waiting } };
}

// The same address `lib/notify/email.ts` sends from; kept here so this module stays importable by pure checks.
const SUPPORT = "support@ferreto.io";

/**
 * What a card is, in one line of at most 120 characters: the digest and Today both name cards with it (review
 * follow-up S3). One line, because a post's own newlines would land in an email's Subject header.
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
    : s.kind === "schedule" ? [str(s.text) ?? str(s.title) ?? "A post", platformName(s.platform)].filter(Boolean).join(" · ")
    : (str(s.title) ?? str(s.text));
  return (pick ?? "A card waits for you").replace(/\s+/g, " ").trim().slice(0, 120);
}

function platformName(p: unknown): string | null {
  if (typeof p !== "string" || !p) return null;
  return p === "x" ? "X" : p.charAt(0).toUpperCase() + p.slice(1);
}

/** "r/SaaS" or the platform's name, for a sales thread. */
function sourceOf(platform: string | null, community: string | null): string {
  const known = SALES_PLATFORMS.find((p) => p === platform) ?? "reddit";
  const c = (community ?? "").trim();
  return (c || PLATFORM_LABEL[known]).slice(0, 60);
}

/** The thread's own words: Pain first, then Evidence, as the scan stored them (with curly quotes). */
export function personQuote(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  for (const label of ["Pain", "Evidence"]) {
    const part = parts.find((p) => (p as { label?: unknown })?.label === label) as { evidence?: unknown; score?: unknown } | undefined;
    const ev = typeof part?.evidence === "string" ? part.evidence.trim() : "";
    // Only a quote: the scan writes "No clear pain in their words" when it found none.
    if (!/^[“"]/.test(ev) || (typeof part?.score === "number" && part.score <= 0)) continue;
    const words = ev.replace(/^[“"]+|[”"]+$/g, "").replace(/\s+/g, " ").trim();
    if (words) return words.length > 220 ? `${words.slice(0, 217).trimEnd()}...` : words;
  }
  return null;
}

/**
 * Reads one founder's digest content. Works with the founder's session (RLS) or the service role. `since` is when the
 * last morning email went out: people found after it are new, and follow-ups checked after it are shown.
 */
export async function loadDigestInput(
  db: SupabaseClient,
  userId: string,
  opts: { appUrl: string; dateLabel: string; now?: Date; timezone?: string; since?: string | null; schedule?: string; unsubscribeUrl?: string },
): Promise<DigestInput> {
  const now = opts.now ?? new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const since = opts.since ?? dayAgo;
  const [waiting, out, stuck, answered] = await Promise.all([
    db.from("approvals").select("id, kind, department, ref_kind, ref_id, snapshot, expires_at, auto_at, post_at").eq("user_id", userId).eq("status", "waiting").order("created_at").limit(100),
    db.from("content_items").select("idea, platform, final_text").eq("user_id", userId).eq("status", "published").gte("published_at", dayAgo).limit(20),
    db.from("work_orders").select("title, department, error").eq("user_id", userId).eq("status", "failed").gte("updated_at", dayAgo).limit(20),
    db
      .from("cmo_draft_outcomes")
      .select("item_id, outcome_replies, outcome_url")
      .eq("user_id", userId)
      .eq("department", "sales")
      .eq("outcome_status", "found")
      .gt("outcome_replies", 0)
      .gte("outcome_checked_at", since)
      .order("outcome_checked_at", { ascending: false })
      .limit(DIGEST_FOLLOW_UPS),
  ]);
  for (const r of [waiting, out, stuck, answered]) if (r.error) throw new Error(`digest: ${r.error.message}`);
  type Card = { id: string; kind: string; department: string; ref_kind: string; ref_id: string; snapshot: Record<string, unknown>; expires_at: string | null; auto_at: string | null; post_at: string | null };
  const cards = (waiting.data ?? []) as Card[];
  const replyCards = cards.filter((c) => c.kind === "reply" && c.ref_kind === "opportunity");
  const outcomes = (answered.data ?? []) as { item_id: string; outcome_replies: number; outcome_url: string | null }[];
  const threadIds = [...new Set([...replyCards.map((c) => c.ref_id), ...outcomes.map((o) => o.item_id)])];
  type Thread = { id: string; platform: string | null; community: string | null; title: string; url: string; score: number; score_parts: unknown; created_at: string };
  let threads = new Map<string, Thread>();
  if (threadIds.length) {
    const r = await db.from("opportunities").select("id, platform, community, title, url, score, score_parts, created_at").eq("user_id", userId).in("id", threadIds);
    if (r.error) throw new Error(`digest: ${r.error.message}`);
    threads = new Map(((r.data ?? []) as Thread[]).map((t) => [t.id, t]));
  }

  const people = replyCards.flatMap((c): DigestPerson[] => {
    const t = threads.get(c.ref_id);
    if (!t) return [];
    return [{
      approvalId: c.id,
      title: t.title.replace(/\s+/g, " ").trim().slice(0, 200) || cardTitle(c.snapshot),
      source: sourceOf(t.platform, t.community),
      score: Math.max(0, Math.min(100, Math.round(Number(t.score) || 0))),
      quote: personQuote(t.score_parts),
      isNew: Date.parse(t.created_at) > Date.parse(since),
    }];
  });
  const followUps = outcomes.flatMap((o): DigestFollowUp[] => {
    const t = threads.get(o.item_id);
    if (!t) return [];
    return [{ title: t.title.replace(/\s+/g, " ").trim().slice(0, 200), source: sourceOf(t.platform, t.community), replies: o.outcome_replies, url: o.outcome_url || t.url }];
  });
  // A post's deadline: autopilot's time, or the time its card expires. Whichever comes first leads the line.
  const postCards = cards
    .filter((c) => c.kind === "post" || c.kind === "schedule")
    .map((c) => ({ c, at: [c.auto_at, c.expires_at].filter((x): x is string => !!x).sort()[0] ?? null }))
    .sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));
  const first = postCards[0];
  const posts: DigestPosts = {
    waiting: postCards.length,
    firstId: first?.c.id ?? null,
    nextAt: first?.at ?? null,
    autopilot: !!first?.c.auto_at && first.at === first.c.auto_at,
    platform: first?.c.auto_at ? platformName(first.c.snapshot.platform) : null,
  };

  return {
    appUrl: opts.appUrl,
    dateLabel: opts.dateLabel,
    timezone: opts.timezone ?? "UTC",
    now,
    people,
    followUps,
    posts,
    schedule: opts.schedule ?? "every morning",
    ...(opts.unsubscribeUrl ? { unsubscribeUrl: opts.unsubscribeUrl } : {}),
    waiting: cards.map((r) => ({ id: r.id, title: cardTitle(r.snapshot), department: r.department })),
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
