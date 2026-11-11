import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { brainModes } from "@/lib/cmo/brain";
import { readAll } from "@/lib/cmo/jobs/progress-run";
import { isoDay, type CmoJobKind } from "@/lib/cmo/jobs/types";
import { dueLoops, type LoopState } from "@/lib/cmo/loops";
import { profileIdOf } from "@/lib/cmo/platforms";
import { socialReaderReady } from "@/lib/cmo/social/reddit";

/**
 * Reads every user's state and enqueues the loops due today (`lib/cmo/loops.ts`). Only enqueues:
 * the runs are dispatched to `/api/internal/cmo/run` by Modal's `sweep()`, in parallel.
 *
 * Called once a day, and safe to call again the same day: a loop that already has a run today (UTC) is skipped
 * (`queuedToday`), whatever became of that run. `enqueue_cmo_run_for` alone only merges runs still queued or running,
 * so a retry of the cron after a timeout used to plan the week and charge for it a second time.
 */
/** Posts drafted for one founder in a day: one run per due item (X, Threads, LinkedIn), the oldest first. */
const POST_RUNS_A_DAY = 3;
const DRAFT_LOOP = "daily-x-draft";

type DueRow = { id: string; user_id: string; department: string; idea: string; platform: string | null };

/** Loops that call a model: for a founder in mode B they go to the inbox instead. */
const THINKING: ReadonlySet<CmoJobKind> = new Set(["plan_week", "post_draft", "sales_scan", "competitor_research", "summarize_memory", "review_week"]);

/** The first item of each post profile, in the given order (oldest due first); an unknown label counts as X. */
export function duePerPlatform<T extends { platform: string | null }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const profile = profileIdOf(row.platform) ?? "x";
    return seen.has(profile) ? false : (seen.add(profile), true);
  });
}

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
    if (typeof row.input?.loop === "string") out.add(loopKey(row.user_id, row.input.loop, typeof row.input.item_id === "string" ? row.input.item_id : null));
  }
  return out;
}

/**
 * Queues the drafts of the posts due today, one per platform, each linked to its calendar item and work order. The
 * daily schedule calls it for every founder; the weekly plan calls it for the week it just wrote (`runId`), so
 * Monday's post is the plan's, drafted the day it is planned for. Returns `[queued, of them to the inbox]`.
 */
export async function enqueueDueDrafts(
  admin: SupabaseClient,
  user: string,
  due: readonly { id: string; platform: string | null }[],
  opts: { claude: boolean; done?: Set<string> },
): Promise<[number, number]> {
  const posts = duePerPlatform(due).slice(0, POST_RUNS_A_DAY);
  const links = await dueLinks(admin, posts.map((d) => d.id));
  let queued = 0;
  for (const post of posts) {
    if (opts.done?.has(loopKey(user, DRAFT_LOOP, post.id))) continue;
    const input = {
      source: "schedule",
      loop: DRAFT_LOOP,
      item_id: post.id,
      ...(links.get(post.id) ? { order_id: links.get(post.id) } : {}),
      ...(opts.claude ? { brain: "claude" } : {}),
    };
    const { error } = await admin.rpc("enqueue_cmo_run_for", { p_user: user, p_kind: "post_draft", p_input: input });
    // Out of credits or at the daily cap: skip this draft, keep going for the others.
    if (error) console.warn("[cron] cmo: skipped", DRAFT_LOOP, error.message);
    else queued += 1;
  }
  return [queued, opts.claude ? queued : 0];
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

export async function enqueueDueLoops(admin: SupabaseClient): Promise<{ users: number; queued: number; inbox: number }> {
  const today = isoDay();
  const weekday = new Date().getUTCDay();

  // Every read is paged: PostgREST answers at most 1000 rows, and past that founders silently lost their loops.
  const rows = await readAll<{ user_id: string; kind: string; body: Record<string, unknown> }>((from, to) =>
    admin.from("marketing_documents_latest").select("user_id, kind, body").in("kind", ["product", "competitors"]).order("user_id").order("kind").range(from, to),
  );
  const users = [...new Set(rows.filter((r) => r.kind === "product").map((r) => r.user_id))];
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
  const dueBy = new Map<string, DueRow[]>();
  for (const row of await readAll<DueRow>((from, to) =>
    admin.from("content_items").select("id, user_id, department, idea, day, platform").in("department", ["post", "sales"]).eq("status", "planned")
      .lte("day", today).order("day").order("id").range(from, to),
  )) {
    dueBy.set(row.user_id, [...(dueBy.get(row.user_id) ?? []), row]);
  }
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const publishedBy = count(await readAll((from, to) =>
    admin.from("content_items").select("user_id").eq("status", "published").eq("department", "post").gte("published_at", since).order("id").range(from, to),
  ));
  // P6: Zernio measures connected accounts without the social reader; replies are checked three days on (A1, A3).
  const connectedBy = count(await readAll((from, to) => admin.from("social_accounts").select("user_id").eq("status", "connected").order("id").range(from, to)));
  const repliesBy = count(await readAll((from, to) =>
    admin.from("cmo_draft_outcomes").select("user_id").eq("department", "sales").eq("action", "replied").is("outcome_checked_at", null)
      .lte("decided_at", new Date(Date.now() - 3 * 86_400_000).toISOString()).order("id").range(from, to),
  ));
  const socialReader = socialReaderReady();
  const modes = await brainModes(admin, users);
  // CMO review 3, 3.1: loops run for accounts with a plan or credits left, the same rule as `cmo_require_paid`.
  const paid = await paidUsers(admin, users);
  const done = await queuedToday(admin, today);

  let queued = 0;
  let inbox = 0;
  const enqueueFor = async (user: string) => {
    const due = dueBy.get(user) ?? [];
    const duePosts = due.filter((d) => d.department === "post");
    const dueSales = due.find((d) => d.department === "sales");
    const state: LoopState = {
      weekday,
      duePost: duePosts[0] ? { idea: duePosts[0].idea, id: duePosts[0].id } : null,
      dueSales: dueSales ? { idea: dueSales.idea, id: dueSales.id } : null,
      competitorHandles: handles.get(user) ?? 0,
      publishedRecently: publishedBy.get(user) ?? 0,
      connectedAccounts: connectedBy.get(user) ?? 0,
      repliesDue: repliesBy.get(user) ?? 0,
      socialReader,
      paid: paid.has(user),
    };
    // Mode B: the run reads what it needs, then waits in the founder's inbox for their Claude.
    const claude = modes.get(user)?.brain === "claude";
    for (const run of dueLoops(state)) {
      // One post per platform gets its own run (`cmo_enqueue` waits per item), the oldest due first as `pickDueItem`
      // drafts: a day with an X, a Threads and a LinkedIn post drafts all three, and a backlog on X never crowds out
      // the other platforms.
      if (run.kind === "post_draft") {
        const [drafts, toInbox] = await enqueueDueDrafts(admin, user, duePosts, { claude, done });
        queued += drafts;
        inbox += toInbox;
        continue;
      }
      if (done.has(loopKey(user, run.loop))) continue;
      const toInbox = claude && THINKING.has(run.kind);
      const item = run.kind === "sales_scan" ? state.dueSales?.id : undefined;
      const order = item ? (await dueLinks(admin, [item])).get(item) : undefined;
      const input = {
        ...run.input,
        loop: run.loop,
        ...(item ? { item_id: item, ...(order ? { order_id: order } : {}) } : {}),
        ...(toInbox ? { brain: "claude" } : {}),
      };
      const { error: enqueueError } = await admin.rpc("enqueue_cmo_run_for", { p_user: user, p_kind: run.kind, p_input: input });
      // Out of credits or at the daily cap: skip this run, keep going for the others.
      if (enqueueError) console.warn("[cron] cmo: skipped", run.loop, enqueueError.message);
      else {
        queued += 1;
        if (toInbox) inbox += 1;
      }
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
  return { users: users.length, queued, inbox };
}
