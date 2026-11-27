import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { readAll } from "@/lib/cmo/jobs/progress-run";
import { isoDay, SCAN_CADENCES, type CmoJobKind, type ScanCadence } from "@/lib/cmo/jobs/types";
import { dueLoops, type LoopState } from "@/lib/cmo/loops";
import { MAX_POSTS_A_DAY, chosenChannels, connectedOnly, dayTargets, planOrDefault } from "@/lib/cmo/posting-plan";
import { socialReaderReady } from "@/lib/cmo/social/reddit";

/**
 * Reads every user's state and enqueues the loops due today (`lib/cmo/loops.ts`). Only enqueues:
 * the runs are dispatched to `/api/internal/cmo/run` by Modal's `sweep()`, in parallel.
 *
 * Called every hour. A founder's loops are queued from their morning on (`loopHour`), once: a loop that already has a
 * run today (UTC) is skipped (`queuedToday`), whatever became of that run. `enqueue_cmo_run_for` alone only merges
 * runs still queued or running, so a second call used to plan the week and charge for it again. An hour that failed
 * is made up by the next one.
 */

/** The founder's local hour by which the day's drafts are being written. */
export const MORNING_HOUR = 6;

/**
 * The UTC hour from which a founder's loops are queued: the first hour of the UTC day when it is 06:00 or later where
 * they are. The calendar's day is a UTC date (`current_date`), so the day's work cannot start before 00:00 UTC: east
 * of UTC+6 that is already their morning (07:00 in Vietnam, as before), and west of UTC it is 06:00 local instead of
 * the afternoon before. An unknown timezone counts as UTC+6 or east (hour 0, the old behaviour).
 */
export function loopHour(timezone: string | null | undefined, now = new Date()): number {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(midnight);
  } catch {
    return 0;
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(part("hour"));
  // Already the same date at 00:00 UTC: east of UTC (or on it). Otherwise it is still yesterday evening there.
  const east = `${part("year")}-${part("month")}-${part("day")}` === isoDay(0, now);
  return east ? Math.max(0, MORNING_HOUR - hour) : 24 - hour + MORNING_HOUR;
}

/**
 * Posts drafted for one founder in a day: one run per due item, the oldest first, up to the planner's most posts a day
 * (`posting-plan.ts`: X takes 5 since 2026-11-27). Each item is one core post for every platform of its slot (daily
 * core drafts, 2026-11-12).
 */
const POST_RUNS_A_DAY = MAX_POSTS_A_DAY;

/**
 * The backlog guard (owner, 2026-11-27, decision 6): with this many post drafts waiting in review, nothing new is
 * drafted, and so nothing is charged, until the founder reviews them.
 */
export const BACKLOG_MAX = 10;

/** How many more drafts may be queued with `waiting` post drafts in review: never above the guard. */
export function backlogRoom(waiting: number): number {
  return Math.max(0, BACKLOG_MAX - Math.max(0, waiting));
}

/** Hours after the founder's morning when the day's second wave of drafts is queued. */
export const SECOND_WAVE_HOURS = 6;

/**
 * Two waves a day (owner, 2026-11-27, A7): the first `ceil(n / 2)` of a day's `n` slots are drafted from the founder's
 * morning (`loopHour`), the rest six hours later, so the later posts take fresher news. `hour` and `loopHour` are UTC
 * hours; the second wave is never later than 23:00 UTC, the last hour of the calendar's day. An item with no slot (an
 * older plan) or a plan of unknown width is in the first wave.
 */
export function draftWave(slot: number | undefined, n: number, hour: number, loopHour: number): boolean {
  const first = slot === undefined || !Number.isInteger(slot) || n <= 0 || slot < Math.ceil(n / 2);
  return hour >= (first ? loopHour : Math.min(23, loopHour + SECOND_WAVE_HOURS));
}
export const DRAFT_LOOP = "daily-post-draft";
/** The loop's name before 2026-11-12: a day in flight then is not drafted twice. Drop it after 2026-11-19. */
const OLD_DRAFT_LOOP = "daily-x-draft";
/** The scan loop's name before wave 3 (2026-11-20): a scan queued that day under it is not queued twice. */
const OLD_SCAN_LOOP = "reddit-listening";
const SCAN_LOOP = "sales-scan";

type DueRow = { id: string; user_id: string; department: string; idea: string; day?: string; platform: string | null; slot?: unknown };

/**
 * The open work order of each due calendar item. The run carries it (`input.order_id`), so a failed run fails its
 * own order instead of a guess (`work_order_for_run`). Read errors only lose the link, never the run.
 */
async function dueLinks(admin: SupabaseClient, items: (string | undefined)[]): Promise<Map<string, string>> {
  const ids = items.filter((id): id is string => Boolean(id));
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await admin.from("work_orders").select("id, item_id").in("item_id", ids).in("status", ["queued", "deferred"]);
  for (const row of (data ?? []) as { id: string; item_id: string }[]) out.set(row.item_id, row.id);
  return out;
}

/** Founders enqueued side by side: each one is a few round trips, and one at a time ran past the route's 300 s. */
const USERS_AT_ONCE = 8;

/** One loop, for one founder (and one calendar item, for a draft): at most one run a day. */
export const loopKey = (user: string, loop: string, item?: string | null) => `${user}:${loop}:${item ?? ""}`;

/** The loops that already have a run today (UTC), by `loopKey`. */
async function queuedToday(admin: SupabaseClient, today: string): Promise<Set<string>> {
  const rows = await readAll<{ user_id: string; input: { loop?: unknown; item_id?: unknown } | null }>((from, to) =>
    admin.from("cmo_runs").select("user_id, input").eq("input->>source", "schedule").gte("created_at", `${today}T00:00:00Z`).order("id").range(from, to),
  );
  const out = new Set<string>();
  for (const row of rows) {
    if (typeof row.input?.loop !== "string") continue;
    const loop = row.input.loop === OLD_DRAFT_LOOP ? DRAFT_LOOP : row.input.loop === OLD_SCAN_LOOP ? SCAN_LOOP : row.input.loop;
    out.add(loopKey(row.user_id, loop, typeof row.input.item_id === "string" ? row.input.item_id : null));
  }
  return out;
}

/**
 * Queues the drafts of the posts due today, one per item, each linked to its calendar item and work order. The
 * daily schedule calls it for every founder; the weekly plan calls it for the week it just wrote (`runId`), so
 * Monday's post is the plan's, drafted the day it is planned for. Returns how many were queued.
 */
export async function enqueueDueDrafts(
  admin: SupabaseClient,
  user: string,
  due: readonly { id: string; platform: string | null; day?: string; slot?: unknown }[],
  opts: { done?: Set<string>; wave?: { n: number; hour: number; loopHour: number } } = {},
): Promise<number> {
  const slotOf = (d: { slot?: unknown }) => (typeof d.slot === "number" && Number.isInteger(d.slot) ? d.slot : undefined);
  // The oldest day first, then the day's slots in order (A7); the sort is stable, so the caller's order breaks ties.
  const ordered = [...due].sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "") || (slotOf(a) ?? 99) - (slotOf(b) ?? 99));
  const wave = opts.wave;
  const open = ordered.filter((d) => !opts.done?.has(loopKey(user, DRAFT_LOOP, d.id)) && (!wave || draftWave(slotOf(d), wave.n, wave.hour, wave.loopHour)));
  if (!open.length) return 0;
  // The backlog guard: count what waits for review before queuing anything (decision 6).
  const { count, error: countError } = await admin.from("content_items").select("id", { count: "exact", head: true })
    .eq("user_id", user).eq("department", "post").eq("status", "in_review");
  if (countError) {
    // Unknown backlog: queue nothing this hour rather than charge a founder who may be over the guard.
    console.warn("[cron] cmo: backlog not read for", user, countError.message);
    return 0;
  }
  const room = backlogRoom(count ?? 0);
  if (room === 0) {
    console.info("[cron] cmo: backlog full, no draft queued for", user);
    return 0;
  }
  // The day's cap counts what this loop already queued today (each hourly call sees those in `done`).
  const mine = loopKey(user, DRAFT_LOOP, "");
  const queuedEarlier = [...(opts.done ?? [])].filter((key) => key.startsWith(mine)).length;
  const posts = open.slice(0, Math.max(0, Math.min(POST_RUNS_A_DAY - queuedEarlier, room)));
  if (!posts.length) return 0;
  const links = await dueLinks(admin, posts.map((d) => d.id));
  let queued = 0;
  for (const post of posts) {
    const input = {
      source: "schedule",
      loop: DRAFT_LOOP,
      item_id: post.id,
      ...(links.get(post.id) ? { order_id: links.get(post.id) } : {}),
    };
    const { error } = await admin.rpc("enqueue_cmo_run_for", { p_user: user, p_kind: "post_draft", p_input: input });
    // Out of credits or at the daily cap: skip this draft, keep going for the others.
    if (error) console.warn("[cron] cmo: skipped", DRAFT_LOOP, error.message);
    else queued += 1;
  }
  return queued;
}

/**
 * The users with a plan on sale or credits left: SQL `cmo_paid`, the one rule (`cmo_paid_users`). A chunk that cannot
 * be read counts its users as unpaid: their loops wait a day.
 */
async function paidUsers(admin: SupabaseClient, users: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < users.length; i += 500) {
    const { data, error } = await admin.rpc("cmo_paid_users", { p_users: users.slice(i, i + 500) });
    if (error) {
      // These users wait a day; the others still get their loops.
      console.warn("[cron] cmo: could not read plans", error.message);
      continue;
    }
    for (const id of (data ?? []) as string[]) out.add(id);
  }
  return out;
}

/**
 * Each founder's timezone and saved posting plan (`profiles`), read in chunks: one filter with every id is a URL
 * PostgREST refuses.
 */
async function profilesOf(admin: SupabaseClient, users: string[]): Promise<Map<string, { timezone: string; postingPlan: unknown }>> {
  const out = new Map<string, { timezone: string; postingPlan: unknown }>();
  for (let i = 0; i < users.length; i += 200) {
    const { data, error } = await admin.from("profiles").select("id, timezone, posting_plan").in("id", users.slice(i, i + 200));
    if (error) throw new Error(`profiles: ${error.message}`);
    for (const row of (data ?? []) as { id: string; timezone: string | null; posting_plan: unknown }[]) {
      out.set(row.id, { timezone: row.timezone ?? "UTC", postingPlan: row.posting_plan });
    }
  }
  return out;
}

/**
 * Today's slots as `[{slot, targets}]` for `cmo_fill_day_slots` (A6): the plan as it really runs (the saved plan or the
 * default, with no post for a platform that has no connected account), as the week plan reads it.
 */
export function daySlots(saved: unknown, connected: readonly string[], chosen: readonly string[]): { slot: number; targets: string[] }[] {
  return dayTargets(connectedOnly(planOrDefault(saved, connected, chosen), connected)).map((targets, slot) => ({ slot, targets }));
}

/** `users`: the founders whose morning has come; `waiting`: those whose loops a later hour queues. */
export async function enqueueDueLoops(admin: SupabaseClient, now = new Date()): Promise<{ users: number; waiting: number; queued: number }> {
  const today = isoDay(0, now);
  const weekday = now.getUTCDay();

  // Every read is paged: PostgREST answers at most 1000 rows, and past that founders silently lost their loops.
  const rows = await readAll<{ user_id: string; kind: string; body: Record<string, unknown> }>((from, to) =>
    admin.from("marketing_documents_latest").select("user_id, kind, body").in("kind", ["product", "competitors", "post_plan"]).order("user_id").order("kind").range(from, to),
  );
  const everyone = [...new Set(rows.filter((r) => r.kind === "product").map((r) => r.user_id))];
  const profiles = await profilesOf(admin, everyone);
  const hourOf = (user: string) => loopHour(profiles.get(user)?.timezone, now);
  const users = everyone.filter((user) => hourOf(user) <= now.getUTCHours());
  const waiting = everyone.length - users.length;
  if (!users.length) return { users: 0, waiting, queued: 0 };
  const handles = new Map<string, number>();
  for (const row of rows.filter((r) => r.kind === "competitors")) {
    const list = Array.isArray(row.body.competitors) ? (row.body.competitors as { x_handle?: unknown }[]) : [];
    handles.set(row.user_id, list.filter((c) => typeof c.x_handle === "string" && c.x_handle.trim()).length);
  }

  const count = (list: { user_id: string }[]) => {
    const by = new Map<string, number>();
    for (const row of list) by.set(row.user_id, (by.get(row.user_id) ?? 0) + 1);
    return by;
  };
  const channelsBy = new Map(rows.filter((r) => r.kind === "post_plan").map((r) => [r.user_id, chosenChannels(r.body)]));
  const dueBy = new Map<string, DueRow[]>();
  for (const row of await readAll<DueRow>((from, to) =>
    admin.from("content_items").select("id, user_id, department, idea, day, platform, slot:body->slot").in("department", ["post", "sales"]).eq("status", "planned")
      .lte("day", today).order("day").order("id").range(from, to),
  )) {
    dueBy.set(row.user_id, [...(dueBy.get(row.user_id) ?? []), row]);
  }
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const publishedBy = count(await readAll((from, to) =>
    admin.from("content_items").select("user_id").eq("status", "published").eq("department", "post").gte("published_at", since).order("id").range(from, to),
  ));
  // P6: Zernio measures connected accounts without the social reader; replies are checked three days on (A1, A3).
  const platformsBy = new Map<string, string[]>();
  for (const row of await readAll<{ user_id: string; platform: string }>((from, to) =>
    admin.from("social_accounts").select("user_id, platform").eq("status", "connected").order("id").range(from, to),
  )) {
    platformsBy.set(row.user_id, [...(platformsBy.get(row.user_id) ?? []), row.platform]);
  }
  const connectedBy = new Map([...platformsBy].map(([user, list]) => [user, list.length]));
  const repliesBy = count(await readAll((from, to) =>
    admin.from("cmo_draft_outcomes").select("user_id").eq("department", "sales").eq("action", "replied").is("outcome_checked_at", null)
      .lte("decided_at", new Date(now.getTime() - 3 * 86_400_000).toISOString()).order("id").range(from, to),
  ));
  // Wave 3 B2: the same condition as `cmo_nudges_due`.
  const nudgesBy = count(await readAll((from, to) =>
    admin.from("opportunities").select("user_id").eq("person_status", "replied").is("nudge_draft", null)
      .lte("replied_at", new Date(now.getTime() - 4 * 86_400_000).toISOString()).order("id").range(from, to),
  ));
  // Wave 3: each founder's Sales scan days (Settings › Sales scans); a founder with no row scans Mon/Wed/Fri.
  const cadenceBy = new Map<string, ScanCadence>();
  for (const row of await readAll<{ user_id: string; cadence: string | null }>((from, to) =>
    admin.from("sales_settings").select("user_id, cadence").order("user_id").range(from, to),
  )) {
    if ((SCAN_CADENCES as readonly string[]).includes(row.cadence ?? "")) cadenceBy.set(row.user_id, row.cadence as ScanCadence);
  }
  const socialReader = socialReaderReady();
  // CMO review 3, 3.1: loops run for accounts with a plan or credits left, the same rule as `cmo_require_paid`.
  const paid = await paidUsers(admin, users);
  const done = await queuedToday(admin, today);

  let queued = 0;
  const enqueueFor = async (user: string) => {
    const due = dueBy.get(user) ?? [];
    const duePosts = due.filter((d) => d.department === "post");
    const slots = daySlots(profiles.get(user)?.postingPlan, platformsBy.get(user) ?? [], channelsBy.get(user) ?? []);
    // A6: today's slots the week plan did not fill (the founder raised a count mid-week) get a planned item before the
    // drafts are queued. Not on Monday: the week plan written today fills them, and an item made here would be drafted
    // beside the plan's own. Not for an unpaid account: it gets no draft.
    if (weekday !== 1 && paid.has(user) && slots.length) {
      const { data: made, error: fillError } = await admin.rpc("cmo_fill_day_slots", { p_user: user, p_day: today, p_items: slots });
      if (fillError) console.warn("[cron] cmo: today's empty slots not filled for", user, fillError.message);
      for (const row of (made ?? []) as { id?: unknown; slot?: unknown }[]) {
        if (typeof row.id === "string") duePosts.push({ id: row.id, user_id: user, department: "post", idea: "Today's post, from your content plan", day: today, platform: null, slot: row.slot });
      }
    }
    const dueSales = due.find((d) => d.department === "sales");
    const state: LoopState = {
      weekday,
      duePost: duePosts[0] ? { idea: duePosts[0].idea, id: duePosts[0].id } : null,
      dueSales: dueSales ? { idea: dueSales.idea, id: dueSales.id } : null,
      competitorHandles: handles.get(user) ?? 0,
      publishedRecently: publishedBy.get(user) ?? 0,
      connectedAccounts: connectedBy.get(user) ?? 0,
      repliesDue: repliesBy.get(user) ?? 0,
      nudgesDue: nudgesBy.get(user) ?? 0,
      scanCadence: cadenceBy.get(user) ?? "mwf",
      socialReader,
      paid: paid.has(user),
    };
    for (const run of dueLoops(state)) {
      // Each due item gets its own run (`cmo_enqueue` waits per item), the oldest first as `pickDueItem` drafts: one
      // core post per slot, which goes to every platform of the slot.
      if (run.kind === "post_draft") {
        // Awaited first: `queued += await …` reads `queued` before the wait, and the other workers' counts are lost.
        const drafts = await enqueueDueDrafts(admin, user, duePosts, { done, wave: { n: slots.length, hour: now.getUTCHours(), loopHour: hourOf(user) } });
        queued += drafts;
        continue;
      }
      if (done.has(loopKey(user, run.loop))) continue;
      const item = run.kind === "sales_scan" ? state.dueSales?.id : undefined;
      const order = item ? (await dueLinks(admin, [item])).get(item) : undefined;
      const input = {
        ...run.input,
        loop: run.loop,
        ...(item ? { item_id: item, ...(order ? { order_id: order } : {}) } : {}),
      };
      const { error: enqueueError } = await admin.rpc("enqueue_cmo_run_for", { p_user: user, p_kind: run.kind, p_input: input });
      // Out of credits or at the daily cap: skip this run, keep going for the others.
      if (enqueueError) console.warn("[cron] cmo: skipped", run.loop, enqueueError.message);
      else queued += 1;
    }
  };
  // A fixed number of workers walk the list; one founder's failure is logged and the others still get their loops.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(USERS_AT_ONCE, users.length) }, async () => {
      while (next < users.length) {
        const user = users[next++]!;
        await enqueueFor(user).catch((error) => console.error("[cron] cmo: loops not queued for", user, error));
      }
    }),
  );
  return { users: users.length, waiting, queued };
}
