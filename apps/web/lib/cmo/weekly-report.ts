/**
 * The weekly report (wave 3 B8; redesign plan, "Emails"): on Mondays it replaces that day's morning email. It counts
 * people and conversations, not posts and views: found, replied, answered back, signed up over the last 7 days, where
 * the answers came from, the problem people raised most (the Library), and the posts that went out. A template, no
 * model call; every number is a count of the founder's own rows, so nothing in it is invented.
 *
 * `lib/notify/send.ts` emails it on Mondays; the counts follow `my_funnel` (SQL) so the email and Analytics agree.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { escapeHtml } from "./digest";
import { PLATFORM_LABEL, SALES_PLATFORMS, type SalesPlatform } from "./social/conversations";

export const WEEK_DAYS = 7;
/** Posts named in the email; the rest are counted. */
export const WEEKLY_POSTS = 3;

export type FunnelCounts = { found: number; replied: number; answeredBack: number; signedUp: number };
export type SourceCounts = FunnelCounts & { platform: SalesPlatform };

export type WeeklyInput = {
  appUrl: string;
  /** The founder's local date, already formatted ("Monday 23 Nov"). */
  dateLabel: string;
  total: FunnelCounts;
  bySource: SourceCounts[];
  /** The Library theme with the most conversations saved this week. */
  topTheme: { name: string; count: number } | null;
  /** Posts published this week, newest first. */
  posts: { title: string; where: string }[];
  /** "every weekday at 08:00" (`digestScheduleLabel`). */
  schedule: string;
  unsubscribeUrl?: string;
};

export type Weekly = {
  subject: string;
  preview: string;
  text: string;
  html: string;
  /** Nothing found, replied or posted this week: logged as skipped, not sent. */
  empty: boolean;
  summary: { found: number; replied: number; answeredBack: number; signedUp: number; posts: number };
};

type PersonRow = { platform: string | null; created_at: string; replied_at: string | null; status_at: string | null; person_status: string | null };

const ANSWERED = new Set(["answered_back", "talking", "signed_up", "customer"]);
const SIGNED = new Set(["signed_up", "customer"]);

/** The funnel of `my_funnel`, from the founder's opportunities: what happened since `since`, per source and in all. */
export function countFunnel(rows: PersonRow[], since: Date): { total: FunnelCounts; bySource: SourceCounts[] } {
  const after = (iso: string | null) => iso !== null && Date.parse(iso) > since.getTime();
  const empty = (): FunnelCounts => ({ found: 0, replied: 0, answeredBack: 0, signedUp: 0 });
  const total = empty();
  const per = new Map<SalesPlatform, FunnelCounts>();
  for (const row of rows) {
    const platform = (SALES_PLATFORMS as readonly string[]).includes(row.platform ?? "") ? (row.platform as SalesPlatform) : "reddit";
    const c = per.get(platform) ?? empty();
    const add = (key: keyof FunnelCounts, yes: boolean) => {
      if (!yes) return;
      c[key] += 1;
      total[key] += 1;
    };
    add("found", after(row.created_at));
    add("replied", after(row.replied_at));
    add("answeredBack", after(row.status_at) && ANSWERED.has(row.person_status ?? ""));
    add("signedUp", after(row.status_at) && SIGNED.has(row.person_status ?? ""));
    per.set(platform, c);
  }
  const bySource = SALES_PLATFORMS.flatMap((platform) => {
    const c = per.get(platform);
    return c && (c.found || c.replied || c.answeredBack || c.signedUp) ? [{ platform, ...c }] : [];
  });
  return { total, bySource };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One plain line on where the week's answers came from; null when there is nothing to say yet. */
export function whatWorked(bySource: SourceCounts[]): string | null {
  const best = [...bySource].sort((a, b) => b.answeredBack - a.answeredBack || b.replied - a.replied)[0];
  if (!best) return null;
  const where = PLATFORM_LABEL[best.platform];
  if (best.answeredBack > 0) return `Your replies on ${where} got the most answers: ${plural(best.answeredBack, "person", "people")} answered back.`;
  if (best.replied > 0) return `You replied most on ${where}. Nobody has answered back yet.`;
  return `Most of the people found were on ${where}. You have not replied to them yet.`;
}

export function buildWeekly(input: WeeklyInput): Weekly {
  const base = input.appUrl.replace(/\/$/, "");
  const { total } = input;
  const empty = total.found === 0 && total.replied === 0 && total.answeredBack === 0 && total.signedUp === 0 && input.posts.length === 0;
  const subject = (
    total.found || total.replied
      ? `Your week: ${plural(total.found, "person", "people")} found, ${total.replied} replied, ${total.answeredBack} answered back`
      : input.posts.length
        ? `Your week: ${plural(input.posts.length, "post", "posts")} went out`
        : "Your week"
  ).slice(0, 150);
  const worked = whatWorked(input.bySource);
  const theme = input.topTheme ? `People talked most about ${input.topTheme.name.toLowerCase()} (${plural(input.topTheme.count, "conversation", "conversations")}).` : null;
  const preview = (worked ?? theme ?? subject).slice(0, 160);
  const posts = input.posts.slice(0, WEEKLY_POSTS);
  const more = input.posts.length - posts.length;

  const rows: [string, number][] = [
    ["Found", total.found],
    ["You replied", total.replied],
    ["Answered back", total.answeredBack],
    ["Signed up", total.signedUp],
  ];
  const settingsUrl = `${base}/app/settings#notifications`;
  const stopUrl = input.unsubscribeUrl ?? settingsUrl;
  const footer = [
    "Every number here counts your own conversations and posts from the last 7 days.",
    // A founder who chose Monday emails only gets this report as that email: no morning email to promise them.
    input.schedule.startsWith("every Monday")
      ? "You chose one email a week: this report is it, every Monday."
      : `This report replaces your Monday morning email. You get the morning email ${input.schedule}.`,
  ];

  const text = [
    preview,
    "",
    "THIS WEEK",
    ...rows.map(([label, n]) => `- ${label}: ${n}`),
    ...(input.bySource.length > 1 ? ["", "BY SOURCE", ...input.bySource.map((s) => `- ${PLATFORM_LABEL[s.platform]}: ${s.found} found, ${s.replied} replied, ${s.answeredBack} answered back`)] : []),
    ...(worked ? ["", "WHAT WORKED", worked] : []),
    ...(theme ? ["", "WHAT PEOPLE SAID MOST", theme, `${base}/app/library`] : []),
    ...(posts.length ? ["", "POSTS THAT WENT OUT", ...posts.map((p) => `- ${p.where}: ${p.title}`), ...(more > 0 ? [`and ${more} more`] : [])] : []),
    "",
    `Open Sales: ${base}/app/sales`,
    "--",
    ...footer,
    `Change when it comes: ${settingsUrl}`,
    `Stop these emails: ${stopUrl}`,
  ].join("\n");

  const muted = "#69695d";
  const accent = "#c93a0f";
  const h2 = (t: string) => `<h2 style="font:600 12px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${muted};margin:24px 0 8px">${escapeHtml(t)}</h2>`;
  const a = (href: string, label: string, color = accent) => `<a href="${escapeHtml(href)}" style="color:${color}">${escapeHtml(label)}</a>`;
  const html = [
    `<div style="font:14px/1.5 Inter,sans-serif;color:#2b2723;max-width:560px">`,
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div>`,
    `<h1 style="font:600 18px Inter,sans-serif;margin:0 0 4px">${escapeHtml(subject)}</h1>`,
    `<p style="color:${muted};margin:0">${escapeHtml(input.dateLabel)}</p>`,
    h2("This week"),
    `<table style="border-collapse:collapse">${rows.map(([label, n]) => `<tr><td style="padding:2px 16px 2px 0;color:${muted}">${escapeHtml(label)}</td><td style="font-weight:600">${n}</td></tr>`).join("")}</table>`,
    input.bySource.length > 1
      ? h2("By source") + input.bySource.map((s) => `<div>${escapeHtml(PLATFORM_LABEL[s.platform])}: ${s.found} found, ${s.replied} replied, ${s.answeredBack} answered back</div>`).join("")
      : "",
    worked ? h2("What worked") + `<p style="margin:0">${escapeHtml(worked)}</p>` : "",
    theme ? h2("What people said most") + `<p style="margin:0">${a(`${base}/app/library`, theme, "#2b2723")}</p>` : "",
    posts.length
      ? h2("Posts that went out") + posts.map((p) => `<div><span style="color:${muted}">${escapeHtml(p.where)}</span> ${escapeHtml(p.title)}</div>`).join("") + (more > 0 ? `<div style="color:${muted}">and ${more} more</div>` : "")
      : "",
    `<p style="margin:20px 0 0">${a(`${base}/app/sales`, "Open Sales")}</p>`,
    `<p style="font:12px/1.5 Inter,sans-serif;color:${muted};margin-top:28px;border-top:1px solid #e3e1da;padding-top:12px">` +
      footer.map(escapeHtml).join(" ") +
      ` ${a(settingsUrl, "Change when it comes", muted)} · ${a(stopUrl, "Stop these emails", muted)}</p>`,
    `</div>`,
  ].join("");
  return {
    subject,
    preview,
    text,
    html,
    empty,
    summary: { found: total.found, replied: total.replied, answeredBack: total.answeredBack, signedUp: total.signedUp, posts: input.posts.length },
  };
}

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`weekly ${what}: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

/** Reads one founder's week with the service role; every query names the user (RLS does not narrow it). */
export async function loadWeeklyInput(
  db: SupabaseClient,
  userId: string,
  opts: { appUrl: string; dateLabel: string; now?: Date; schedule?: string; unsubscribeUrl?: string },
): Promise<WeeklyInput> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - WEEK_DAYS * 86_400_000);
  const iso = since.toISOString();
  const [people, entries, posts] = await Promise.all([
    db.from("opportunities").select("platform, created_at, replied_at, status_at, person_status").eq("user_id", userId)
      .or(`created_at.gt.${iso},replied_at.gt.${iso},status_at.gt.${iso}`).limit(2000),
    db.from("library_entries").select("theme_id").eq("user_id", userId).gt("created_at", iso).limit(2000),
    db.from("content_items").select("idea, platform, final_text, published_at").eq("user_id", userId).eq("department", "post")
      .eq("status", "published").gt("published_at", iso).order("published_at", { ascending: false }).limit(20),
  ]);
  const { total, bySource } = countFunnel(check(people, "opportunities") as PersonRow[], since);
  const counts = new Map<string, number>();
  for (const e of check(entries, "library") as { theme_id: string | null }[]) if (e.theme_id) counts.set(e.theme_id, (counts.get(e.theme_id) ?? 0) + 1);
  const [topId, topCount] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  let topTheme: WeeklyInput["topTheme"] = null;
  if (topId) {
    const t = await db.from("library_themes").select("name").eq("user_id", userId).eq("id", topId).maybeSingle<{ name: string }>();
    if (t.error) throw new Error(`weekly themes: ${t.error.message}`);
    if (t.data?.name) topTheme = { name: t.data.name.slice(0, 80), count: topCount };
  }
  return {
    appUrl: opts.appUrl,
    dateLabel: opts.dateLabel,
    total,
    bySource,
    topTheme,
    posts: (check(posts, "posts") as { idea: string; platform: string; final_text: string | null }[]).map((p) => ({
      title: (p.final_text ?? p.idea).replace(/\s+/g, " ").trim().slice(0, 120),
      where: p.platform.toUpperCase() === "X" ? "X" : p.platform,
    })),
    schedule: opts.schedule ?? "every weekday",
    ...(opts.unsubscribeUrl ? { unsubscribeUrl: opts.unsubscribeUrl } : {}),
  };
}
