import "server-only";

import type { SupabaseClient } from "@/lib/api/handler";
import { DIGEST_DAYS, loadDigestInput, localClock } from "@/lib/cmo/digest";
import { buildToday } from "@/lib/cmo/today";
import { loadTodayInput } from "@/lib/cmo/today-input";
import { CMO_SKILLS } from "@/lib/cmo/skills/index.gen";
import { profileIdOf, profileOf, POST_PROFILES } from "@/lib/cmo/platforms";
import { readyStyles } from "@/lib/agent/styles";
import { DOCUMENTS, DOCUMENT_KINDS, type DocumentKind } from "@/lib/cmo/documents";
import { JOB_PRICES, classifyOrder, nextCheckAt, type OrderLedgerRow } from "@/lib/cmo/jobs/progress";
import { storedSources } from "@/lib/cmo/jobs/library-sources";
import { connectedPlatforms, withConnected } from "./connected";
import { mondayOf } from "@/lib/cmo/jobs/summarize-memory";
import { chosenChannels, planOrDefault } from "@/lib/cmo/posting-plan";
import { localDay, localMidnight, localMonday } from "@/lib/time-zone";
import { CONNECTABLE_PLATFORMS, PUBLISH_PLATFORMS } from "@/lib/departments/publish/types";
import { isPaidPlan } from "@/lib/pricing";
import { SITE_URL } from "@/lib/site";

import scheduleDefaults from "../../../../packages/contracts/schedule-defaults.json";

import { RangeSchema, type AnalyticsScreen } from "./analytics";
import { buildAnalytics, buildResults, type AccountDayIn, type AccountIn, type PostIn } from "./analytics-build";
import type { ApprovalCard } from "./approval-card";
import type { BrainScreen, OrderRow, OrderState } from "./brain";
import { buildMeasures, type WeekCounts } from "./brain-measures";
import { APPROVAL_COLUMNS, REACH_COLUMNS, approvalToCard, replyOpportunityIds, withReach, type ApprovalRow, type ReachRow } from "./cards";
import { enrichScheduleCards } from "./schedule-enrich";
import { signStudioCards } from "./studio-sign";
import { DEPARTMENTS, TEAM, salesNeeds, salesRuleKind, type CmoState, type Department } from "./common";
import type { DashboardScreen } from "./dashboard";
import { SKILL_READERS, type LibraryScreen } from "./library";
import type { RailStatus } from "./rail";
import type { ResearchScreen } from "./research";
import { numbersFromNewest, personNumbers, usedIn, type PersonRow, type PostRow } from "./numbering";
import type { SalesScan, SalesScreen } from "./sales";
import { SALES_PLATFORMS, type SalesPlatform } from "../cmo/social/conversations";
import { LibraryEntrySchema } from "../cmo/library";
import { PERSON_STATUSES, REACH_LEVELS, ReachCheckSchema } from "../cmo/reach";
import type { ScreenData, ScreenName } from "./registry";
import type { ScheduleScreen } from "./schedule";
import { AUTOPILOT_HOURS, AUTOPILOT_PLATFORMS, type SettingsScreen } from "./settings";
import type { StudioItem, StudioScreen, TeamStep } from "./studio";
import { videoSteps, type VideoStepRow } from "./video-steps";
import type { WriterScreen } from "./writer";

export type LoadContext = { supabase: SupabaseClient; userId: string; params: URLSearchParams };

type Loader<N extends ScreenName> = (ctx: LoadContext) => Promise<Partial<ScreenData<N>>>;

const iso = (v: string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

/**
 * Runs each part on its own: a part that fails is left out, so its field stays sample (or empty in production) and
 * not live, instead of failing the whole screen.
 */
async function parts<T extends object>(label: string, readers: { [K in keyof T]?: () => Promise<T[K]> }): Promise<Partial<T>> {
  const keys = Object.keys(readers) as (keyof T)[];
  const results = await Promise.allSettled(keys.map((k) => readers[k]!()));
  const out: Partial<T> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out[keys[i]!] = r.value;
    else console.warn(`[screens] ${label}.${String(keys[i])} not loaded`, r.reason instanceof Error ? r.reason.message : r.reason);
  });
  return out;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

type Profile = { weekly_credit_budget: number; timezone: string; digest_hour: number | null; cmo_paused_at: string | null; plan: string };

/**
 * The profile row, read once per Supabase client and founder. Seven readers want it and `loadScreens` runs them
 * together, so a single screen request used to make seven identical `profiles` queries. The client is made per
 * request, so the entry lives exactly as long as the request does; a read that fails is dropped again, so a
 * long-lived client (the crons' admin one) does not keep a transient failure.
 */
const profileOnce = new WeakMap<SupabaseClient, Map<string, Promise<Profile>>>();

function profile(supabase: SupabaseClient, userId: string): Promise<Profile> {
  let byUser = profileOnce.get(supabase);
  if (!byUser) profileOnce.set(supabase, (byUser = new Map()));
  const started = byUser.get(userId);
  if (started) return started;
  const run = readProfile(supabase, userId).catch((error: unknown) => {
    byUser.delete(userId);
    throw error;
  });
  byUser.set(userId, run);
  return run;
}

async function readProfile(supabase: SupabaseClient, userId: string): Promise<Profile> {
  const r = await supabase.from("profiles").select("weekly_credit_budget, timezone, digest_hour, cmo_paused_at, plan").eq("id", userId).maybeSingle();
  if (r.error || !r.data) throw new Error(`profiles: ${r.error?.message ?? "missing"}`);
  return r.data as Profile;
}

async function cmoState(p: Promise<Profile>): Promise<CmoState> {
  return { pausedAt: iso((await p).cmo_paused_at) };
}

/** The queue: waiting cards, oldest first, Studio pictures signed, schedule cards in the founder's time. Kinds the app cannot show yet are left out. */
async function waitingCards(supabase: SupabaseClient, userId: string): Promise<ApprovalCard[]> {
  const rows = must(
    await supabase.from("approvals").select(APPROVAL_COLUMNS).eq("status", "waiting").order("created_at", { ascending: true }).limit(100),
    "approvals",
  ) as ApprovalRow[];
  const cards = await signStudioCards(supabase, rows.map((row) => approvalToCard(row)).filter((c): c is ApprovalCard => c !== null), rows);
  return withReach(await enrichScheduleCards(supabase, userId, cards), rows, await replyReach(supabase, rows));
}

/** Wave 4 B3: the reach of the people the waiting reply cards are about. Not read means no reach on the card, never no queue. */
async function replyReach(supabase: SupabaseClient, rows: ApprovalRow[]): Promise<ReachRow[]> {
  const ids = replyOpportunityIds(rows);
  if (!ids.length) return [];
  const r = await supabase.from("opportunities").select(REACH_COLUMNS).in("id", ids);
  if (r.error) {
    console.warn("[screens] reply reach not loaded", r.error.message);
    return [];
  }
  return (r.data ?? []) as unknown as ReachRow[];
}

type OrderDb = OrderLedgerRow & { user_id: string; root_id: string | null; week: string; created_at: string; done_reason: string | null };
const ORDER_COLUMNS = "id, user_id, root_id, parent_id, week, kind, title, department, status, due_at, budget_credits, spent_credits, updated_at, created_at, brief, error, done_reason";

/** This week's tree: the root and its orders, parents before children. */
async function weekTree(supabase: SupabaseClient, week = mondayOf()): Promise<{ root: OrderDb | null; orders: OrderDb[] }> {
  const rows = must(await supabase.from("work_orders").select(ORDER_COLUMNS).eq("week", week).order("created_at").limit(500), "work_orders") as OrderDb[];
  const root = rows.find((o) => o.parent_id === null) ?? null;
  const children = rows.filter((o) => o.parent_id !== null);
  const sorted: OrderDb[] = [];
  const visit = (parent: string) => {
    // Orders of one plan share `created_at` (one transaction): sort siblings by when they are due.
    const siblings = children
      .filter((c) => c.parent_id === parent)
      .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") || a.created_at.localeCompare(b.created_at));
    for (const o of siblings) {
      sorted.push(o);
      visit(o.id);
    }
  };
  if (root) visit(root.id);
  return { root, orders: sorted };
}

const STATE_TEXT: Record<OrderState, string> = {
  queued: "Queued",
  running: "Running",
  waiting_founder: "Waits on you",
  waiting_order: "Waits on another order",
  deferred: "Continues later",
  done: "Done",
  failed: "Stuck",
  cancelled: "Cancelled",
};

function stateText(o: OrderDb, now: Date): string {
  if (o.status === "failed") return o.error?.code === "stuck" ? "Stuck: no progress" : `Stuck: ${(o.error?.message ?? "failed").slice(0, 60)}`;
  if (o.status === "queued" && classifyOrder(o, now, JOB_PRICES[o.kind] ?? 0) === "over_budget") return "Stuck: budget";
  return STATE_TEXT[o.status];
}

/** The waiting card of each order (through its deliverables), for the "Open" link on a row. */
async function cardsByOrder(supabase: SupabaseClient, orderIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!orderIds.length) return out;
  const deliverables = [
    ...(must(await supabase.from("deliverables").select("order_id, ref_kind, ref_id").in("order_id", orderIds), "deliverables") as {
      order_id: string;
      ref_kind: string;
      ref_id: string;
    }[]),
    // Studio's cards hang off its steps, batches and edits, not deliverables (P2).
    ...(await studioRefs(supabase, orderIds)),
  ];
  if (!deliverables.length) return out;
  const waiting = must(
    await supabase.from("approvals").select("id, ref_id").eq("status", "waiting").in("ref_id", deliverables.map((d) => d.ref_id)),
    "approvals",
  ) as { id: string; ref_id: string }[];
  for (const d of deliverables) {
    const card = waiting.find((w) => w.ref_id === d.ref_id);
    if (card && !out.has(d.order_id)) out.set(d.order_id, card.id);
  }
  return out;
}

function orderRows(orders: OrderDb[], cards: Map<string, string>, rootId: string, now: Date): OrderRow[] {
  return orders.map((o) => ({
    id: o.id,
    parentId: o.parent_id === rootId ? null : o.parent_id,
    title: o.title,
    department: o.department as Department,
    dueAt: iso(o.due_at),
    dueText: null,
    credits: { used: o.spent_credits, budget: o.budget_credits },
    state: o.status,
    stateText: stateText(o, now),
    approvalId: cards.get(o.id) ?? null,
  }));
}

async function weekGoal(supabase: SupabaseClient, week = mondayOf()): Promise<string | null> {
  const r = await supabase.from("cmo_goals").select("goal").eq("week", week).eq("status", "approved").maybeSingle();
  if (r.error) throw new Error(`cmo_goals: ${r.error.message}`);
  // Goals saved before the 200-character cap would fail the week strip's contract and blank it.
  const goal = (r.data as { goal: string } | null)?.goal;
  return goal ? clip(goal, 200) : null;
}

const OPEN: ReadonlySet<string> = new Set(["queued", "running", "waiting_founder", "waiting_order", "deferred"]);

async function dashboard({ supabase, userId }: LoadContext): Promise<Partial<DashboardScreen>> {
  const now = new Date();
  const prof = profile(supabase, userId);
  const tree = weekTree(supabase);
  const queue = waitingCards(supabase, userId);
  return parts<DashboardScreen>("dashboard", {
    cmo: () => cmoState(prof),
    queue: () => queue,
    // CMO review 3, 1.1: at most five rows, worked out from the rows above; nothing is stored for it.
    // Only cards the queue can show become rows, so a row always opens in place (`waitingCards` leaves out kinds the
    // app cannot show yet).
    today: async () => {
      const [input, cards] = await Promise.all([loadTodayInput(supabase, userId, { now, timezone: (await prof).timezone }), queue]);
      const shown = new Set(cards.map((card) => card.id));
      return buildToday({
        ...input,
        cards: input.cards.filter((card) => shown.has(card.id)),
        failedSlots: input.failedSlots.filter((slot) => shown.has(slot.approvalId)),
      });
    },
    week: async () => {
      const [{ root, orders }, goal, p] = await Promise.all([tree, weekGoal(supabase), prof]);
      const open = orders.filter((o) => o.status !== "cancelled");
      const today = now.toISOString().slice(0, 10);
      const drafts = must(
        // Drafted today: approving or publishing an older draft is not new writing.
        await supabase.from("content_items").select("body").eq("department", "post").gte("created_at", `${today}T00:00:00Z`).in("status", ["in_review", "approved", "published"]),
        "content_items",
      ) as { body: { text?: string } }[];
      const words = drafts.reduce((n, d) => n + (typeof d.body.text === "string" ? d.body.text.split(/\s+/).filter(Boolean).length : 0), 0);
      // The calendar's items this week and the held cards, so the step bar matches what Writer lists.
      const monday = mondayOf();
      const nextMonday = new Date(Date.parse(`${monday}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
      const [items, held] = await Promise.all([
        supabase.from("content_items").select("id").in("department", ["post", "video"]).gte("day", monday).lt("day", nextMonday)
          .in("status", ["planned", "drafting", "in_review", "approved", "published"]).limit(500),
        supabase.from("approvals").select("id").eq("status", "held").limit(500),
      ]);
      return {
        itemsThisWeek: (must(items, "content_items") as unknown[]).length,
        heldCards: (must(held, "approvals") as unknown[]).length,
        goal,
        deliverables: { done: open.filter((o) => o.status === "done").length, total: open.length },
        workingNow: new Set(orders.filter((o) => o.status === "running" && (TEAM as string[]).includes(o.department)).map((o) => o.department)).size,
        wordsDraftedToday: words,
        credits: { used: root?.spent_credits ?? 0, budget: root?.budget_credits ?? p.weekly_credit_budget },
      };
    },
    team: async () => {
      const [{ orders }, cards, p] = await Promise.all([tree, queue, prof]);
      const verdict = (o: OrderDb) => classifyOrder(o, now, JOB_PRICES[o.kind] ?? 0);
      const nodes = TEAM.map((department) => {
        const mine = orders.filter((o) => o.department === department);
        // An order waiting on its generations or renders (Studio) is at work, not idle.
        const running = mine.find((o) => o.status === "running") ?? mine.find((o) => o.status === "waiting_order");
        const stuck = mine.find((o) => verdict(o) === "stuck" || verdict(o) === "over_budget");
        const next = mine.filter((o) => o.status === "queued").sort((a, b) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9"))[0];
        const waitingOn = mine.find((o) => o.status === "waiting_founder");
        const state: "working" | "idle" | "stuck" = stuck ? "stuck" : running ? "working" : "idle";
        const line = stuck
          ? `Stuck: ${stuck.title}`
          : running
            ? `Working on “${running.title}”`
            : waitingOn
              ? `“${waitingOn.title}” waits on you`
              : next
                ? `Next: “${next.title}”`
                : "Idle";
        return { department, state, line: line.slice(0, 120), waiting: cards.filter((c) => c.department === department).length };
      });
      const anyStuck = nodes.some((n) => n.state === "stuck");
      return {
        brain: {
          state: p.cmo_paused_at ? ("paused" as const) : anyStuck ? ("stuck" as const) : ("on_track" as const),
          watching: orders.filter((o) => OPEN.has(o.status)).length,
          nextCheckAt: nextCheckAt(now).toISOString(),
        },
        nodes,
      };
    },
    log: async () => {
      const rows = must(
        await supabase.from("work_order_events").select("id, at, department, text").order("at", { ascending: false }).limit(50),
        "work_order_events",
      ) as { id: number; at: string; department: string; text: string }[];
      return rows.map((r) => ({
        id: String(r.id),
        at: new Date(r.at).toISOString(),
        who: ((DEPARTMENTS as readonly string[]).includes(r.department) ? r.department : "brain") as Department,
        text: r.text,
      }));
    },
    // The slots of today in the founder's time zone, as Schedule shows them (review follow-up Q1): the slot's own time,
    // account and status, not the approval time of the post.
    outToday: async () => {
      const timezone = (await prof).timezone;
      const today = localDay(now, timezone);
      const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const from = new Date(localMidnight(today, timezone) ?? `${today}T00:00:00Z`);
      const to = new Date(localMidnight(tomorrow, timezone) ?? `${tomorrow}T00:00:00Z`);
      const slots = await scheduleSlots(supabase, from, to);
      return slots.slice(0, 20).map((slot) => ({
        id: slot.id,
        at: slot.at,
        where: slot.where,
        text: slot.title,
        status: slot.status,
        problem: slot.status === "failed" ? (slot.note ?? "failed").slice(0, 120) : null,
        approvalId: slot.approvalId,
      }));
    },
    results: async () => {
      const m = await measured(supabase, 7, now);
      return buildResults({ now, accounts: m.accounts, days: m.days, posts: m.posts });
    },
    digest: async () => {
      const p = await prof;
      const clock = localClock(now, p.timezone);
      const input = await loadDigestInput(supabase, userId, { appUrl: SITE_URL, dateLabel: clock.dateLabel, now, timezone: p.timezone, emailOnly: false });
      if (!input.waiting.length && !input.wentOut.length && !input.stuck.length) return null;
      const dept = (d: string) => ((DEPARTMENTS as readonly string[]).includes(d) ? d : "brain") as Department;
      return {
        dateLabel: input.dateLabel.slice(0, 40),
        waiting: input.waiting.map((w) => ({ id: w.id, title: w.title.slice(0, 200), department: dept(w.department) })),
        wentOut: input.wentOut.map((o) => ({ title: o.title.slice(0, 200), where: o.where.slice(0, 40) })),
        stuck: input.stuck.map((s) => ({ title: s.title.slice(0, 200), department: dept(s.department), reason: s.reason.slice(0, 300) })),
      };
    },
  });
}

/** One week's counts for the brain's measures, read under the founder's session. */
async function weekCounts(supabase: SupabaseClient, monday: string, now: Date): Promise<WeekCounts> {
  const from = `${monday}T00:00:00Z`;
  const to = new Date(Date.parse(from) + 7 * 86_400_000).toISOString();
  const [plans, drafts, orders, approved] = await Promise.all([
    supabase.from("approvals").select("status").eq("kind", "goal").in("status", ["approved", "edited", "skipped"]).gte("decided_at", from).lt("decided_at", to).limit(500),
    supabase.from("cmo_draft_outcomes").select("similarity").not("similarity", "is", null).gte("decided_at", from).lt("decided_at", to).limit(2000),
    supabase.from("work_orders").select("id, parent_id, status, due_at, finished_at, spent_credits, brief").eq("week", monday).limit(1000),
    supabase.from("approvals").select("id", { count: "exact", head: true }).in("status", ["approved", "edited"]).gte("decided_at", from).lt("decided_at", to),
  ]);
  const planRows = must(plans, "approvals") as { status: string }[];
  const draftRows = must(drafts, "cmo_draft_outcomes") as { similarity: number }[];
  const orderRows = must(orders, "work_orders") as { id: string; parent_id: string | null; status: string; due_at: string | null; finished_at: string | null; spent_credits: number; brief: Record<string, unknown> | null }[];
  if (approved.error) throw new Error(`approvals: ${approved.error.message}`);
  const children = orderRows.filter((o) => o.parent_id && o.status !== "cancelled");
  const due = children.filter((o) => o.due_at && (o.status === "done" || Date.parse(o.due_at) < now.getTime()));
  return {
    plans: { asIs: planRows.filter((r) => r.status === "approved").length, decided: planRows.length },
    drafts: { asIs: draftRows.filter((r) => r.similarity >= 0.95).length, total: draftRows.length },
    orders: { onTime: due.filter((o) => o.status === "done" && o.finished_at && o.finished_at <= o.due_at!).length, due: due.length },
    credits: { spent: orderRows.filter((o) => !o.parent_id).reduce((n, o) => n + o.spent_credits, 0), approved: approved.count ?? 0 },
    replans: children.filter((o) => o.brief && "replan_of" in o.brief).length,
  };
}

async function brain({ supabase, userId }: LoadContext): Promise<Partial<BrainScreen>> {
  const now = new Date();
  const prof = profile(supabase, userId);
  const tree = weekTree(supabase);
  return parts<BrainScreen>("brain", {
    measures: async () => {
      const monday = mondayOf(now);
      const before = mondayOf(new Date(Date.parse(`${monday}T00:00:00Z`) - 86_400_000));
      const [week, last] = await Promise.all([weekCounts(supabase, monday, now), weekCounts(supabase, before, now)]);
      return buildMeasures(week, last);
    },
    cmo: () => cmoState(prof),
    week: async () => {
      const [{ root, orders }, goal, p] = await Promise.all([tree, weekGoal(supabase), prof]);
      const open = orders.filter((o) => o.status !== "cancelled");
      return {
        goal,
        done: open.filter((o) => o.status === "done").length,
        total: open.length,
        credits: { used: root?.spent_credits ?? 0, budget: root?.budget_credits ?? p.weekly_credit_budget },
        nextCheckAt: nextCheckAt(now).toISOString(),
      };
    },
    orders: async () => {
      const { root, orders } = await tree;
      if (!root) return [];
      const visible = orders.filter((o) => o.status !== "cancelled");
      const [cards, steps] = await Promise.all([
        cardsByOrder(supabase, visible.map((o) => o.id)),
        videoStepsByOrder(supabase, visible.filter((o) => o.kind === "build_video")),
      ]);
      return orderRows(visible, cards, root.id, now).map((row) => (steps.has(row.id) ? { ...row, steps: steps.get(row.id) } : row));
    },
    learned: async () => {
      const [lessons, rules, skips] = await Promise.all([
        supabase.from("cmo_lessons").select("id, week, topic, body, created_at").order("week", { ascending: false }).limit(20),
        supabase.from("cmo_corrections").select("id, rule, created_at, decided_at, source_edits").eq("status", "active").order("created_at", { ascending: false }).limit(10),
        supabase.from("cmo_memories").select("id, body, topic, created_at").eq("kind", "feedback").order("created_at", { ascending: false }).limit(5),
      ]);
      const seen = new Set<string>();
      const latest = (must(lessons, "cmo_lessons") as { id: string; topic: string; body: string; created_at: string }[]).filter((l) =>
        seen.has(l.topic) ? false : (seen.add(l.topic), true),
      );
      const topicLabel = (t: string) => ({ post: "X", sales: "Sales", video: "Video", general: "General" })[t] ?? t;
      return [
        ...(must(rules, "cmo_corrections") as { id: string; rule: string; created_at: string; decided_at: string | null; source_edits: unknown[] }[]).map((r) => ({
          id: r.id,
          kind: "rule" as const,
          scope: "you approved",
          text: r.rule,
          source: Array.isArray(r.source_edits) && r.source_edits.length ? `From ${r.source_edits.length} edits` : "From your edits",
          at: new Date(r.decided_at ?? r.created_at).toISOString(),
          deletable: true,
        })),
        ...latest.map((l) => ({
          id: l.id,
          kind: "lesson" as const,
          scope: topicLabel(l.topic),
          text: l.body.slice(0, 300),
          source: "From last week's results",
          at: new Date(l.created_at).toISOString(),
          deletable: false,
        })),
        ...(must(skips, "cmo_memories") as { id: string; body: string; topic: string; created_at: string }[]).map((m) => ({
          id: m.id,
          kind: "skip_reason" as const,
          scope: topicLabel(m.topic),
          text: m.body.slice(0, 300),
          source: "From a card you skipped",
          at: new Date(m.created_at).toISOString(),
          deletable: true,
        })),
      ];
    },
    corrections: async () => {
      const rows = must(await supabase.from("cmo_corrections").select("id, rule, status, created_at").order("created_at", { ascending: false }).limit(50), "cmo_corrections") as {
        id: string;
        rule: string;
        status: "proposed" | "active" | "rejected";
        created_at: string;
      }[];
      const waiting = must(
        await supabase.from("approvals").select("id, ref_id").eq("ref_kind", "correction").eq("status", "waiting"),
        "approvals",
      ) as { id: string; ref_id: string }[];
      return rows.map((r) => ({
        id: r.id,
        rule: r.rule,
        status: r.status,
        at: new Date(r.created_at).toISOString(),
        approvalId: waiting.find((w) => w.ref_id === r.id)?.id ?? null,
      }));
    },
    pastWeeks: async () => {
      const thisWeek = mondayOf(now);
      const roots = must(
        await supabase.from("work_orders").select("id, week, budget_credits, spent_credits").is("parent_id", null).lt("week", thisWeek).order("week", { ascending: false }).limit(8),
        "work_orders",
      ) as { id: string; week: string; budget_credits: number; spent_credits: number }[];
      if (!roots.length) return [];
      const [children, goals] = await Promise.all([
        supabase.from("work_orders").select("root_id, status").in("root_id", roots.map((r) => r.id)).not("parent_id", "is", null),
        supabase.from("cmo_goals").select("week, goal, target, result, metric, status").in("week", roots.map((r) => r.week)),
      ]);
      const kids = must(children, "work_orders") as { root_id: string; status: string }[];
      const goalRows = must(goals, "cmo_goals") as { week: string; goal: string; target: number; result: number | null; metric: string; status: string }[];
      return roots.map((r) => {
        const mine = kids.filter((k) => k.root_id === r.id && k.status !== "cancelled");
        const g = goalRows.find((x) => x.week === r.week && x.status === "approved");
        const result =
          g && g.result !== null
            ? `${g.result >= g.target ? "Reached" : "Missed"}: ${g.result} of ${g.target} ${g.metric}.`
            : `${mine.filter((k) => k.status === "done").length} of ${mine.length} orders done.`;
        return {
          week: r.week,
          goal: g?.goal ? clip(g.goal, 200) : null,
          result,
          done: mine.filter((k) => k.status === "done").length,
          total: mine.length,
          credits: { used: r.spent_credits, budget: r.budget_credits },
        };
      });
    },
  });
}

// ------------------------------------------------------------------ voice and skills (P3 A3)

/** A row of `voice_notes` (A1): the founder's own words from one decision, its profile and its weight today. */
type VoiceNoteRow = {
  id: string;
  body: string;
  platform: string | null;
  source: "approved" | "edited" | "skipped";
  edit_mode: string | null;
  created_at: string;
  weight: number;
};

/** What an edit mode says the founder did, as Library → Voice names where a note came from. */
const EDIT_SOURCE: Record<string, string> = {
  TOO_SALESY: "less selling",
  WRONG_VOICE: "your own voice",
  INVENTED_CLAIM: "a claim taken out",
  TOO_LONG: "shorter",
  HOOK_REWRITTEN: "a new first line",
  CTA_REMOVED: "no closing ask",
  FULL_REWRITE: "rewritten",
};

function voiceSource(note: VoiceNoteRow): string {
  if (note.source === "approved") return "Approved as written";
  if (note.source === "skipped") return "From a skip reason";
  return `From your edit: ${EDIT_SOURCE[note.edit_mode ?? ""] ?? "rewritten"}`;
}

/** The founder's live voice notes, newest (heaviest) first, under their own session. */
async function voiceNotes(supabase: SupabaseClient, limit: number): Promise<VoiceNoteRow[]> {
  const rows = must(await supabase.rpc("voice_notes", { p_limit: limit, p_platform: null }), "voice_notes") as VoiceNoteRow[];
  return rows.map((r) => ({ ...r, weight: Math.min(1, Math.max(0, Number(r.weight))) }));
}

/** The words the Brand says to avoid: what Writer cuts from every draft. */
async function wordsCut(supabase: SupabaseClient): Promise<string[]> {
  const r = await supabase.from("marketing_documents_latest").select("body").eq("kind", "brand").maybeSingle();
  if (r.error) throw new Error(`marketing_documents_latest: ${r.error.message}`);
  const avoid = (r.data as { body?: { avoid?: unknown } } | null)?.body?.avoid;
  return Array.isArray(avoid)
    ? avoid.filter((w): w is string => typeof w === "string").map((w) => w.trim()).filter((w) => w && w.length <= 40).slice(0, 20)
    : [];
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const shortDate = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The registry agents a built-in writing skill names, as the Library calls them. */
function readersOf(agents: readonly string[]): LibraryScreen["skills"]["writing"][number]["readBy"] {
  const name = (agent: string): (typeof SKILL_READERS)[number] | null =>
    agent === "writer" || agent.endsWith("_writer") ? "Writer" : agent === "checker" ? "Checker" : agent === "sales" ? "Sales" : agent === "cmo" ? "Chat" : agent === "director" || agent === "shorts" ? "Studio" : null;
  return [...new Set(agents.map(name).filter((r): r is (typeof SKILL_READERS)[number] => r !== null))];
}

/** The `?source=` filter of the Library page; anything else reads every source. */
function librarySource(params: URLSearchParams): SalesPlatform | null {
  const v = params.get("source");
  return v && (SALES_PLATFORMS as readonly string[]).includes(v) ? (v as SalesPlatform) : null;
}

async function library({ supabase, params }: LoadContext): Promise<Partial<LibraryScreen>> {
  const source = librarySource(params);
  return parts<LibraryScreen>("library", {
    source: async () => source,
    themes: async () => {
      const rows = must(await supabase.rpc("my_library", { p_source: source }), "my_library") as {
        id: string; name: string; count: number; this_week: number; used_in_posts: number; entries: unknown;
      }[];
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        count: r.count,
        thisWeek: r.this_week,
        usedInPosts: r.used_in_posts,
        // Stored by `cmo_save_library` within the schema's limits; a row that does not parse is left out, not shown broken.
        entries: (Array.isArray(r.entries) ? r.entries : []).flatMap((e) => {
          const parsed = LibraryEntrySchema.safeParse(e && typeof e === "object" ? { ...e, postedAt: iso((e as { postedAt?: string | null }).postedAt) } : e);
          return parsed.success ? [parsed.data] : [];
        }),
      }));
    },
    voice: async () => {
      const [notes, words] = await Promise.all([voiceNotes(supabase, 40), wordsCut(supabase)]);
      return {
        notes: notes.map((n) => ({
          id: n.id,
          text: clip(n.body, 600),
          platform: (n.platform && profileOf(n.platform)?.platform) || null,
          source: voiceSource(n),
          at: new Date(n.created_at).toISOString(),
          weight: n.weight,
          replaces: null,
        })),
        wordsCut: words,
      };
    },
    // Read only (brain.md §8b): the writing guidance and profiles we ship, the style skills, and the founder's own
    // saved from the editor Assistant. Department playbooks stay with their departments.
    skills: async () => {
      const own = must(await supabase.from("editor_skills").select("id, name, description, created_at").order("created_at").limit(50), "editor_skills") as {
        id: string;
        name: string;
        description: string;
        created_at: string;
      }[];
      const slop = CMO_SKILLS["no-ai-slop"];
      return {
        writing: [
          { id: "no-ai-slop", name: "Plain writing (No AI Slop)", origin: "built_in" as const, note: clip(`Guidance, never a hard filter: ${slop.description}`, 200), readBy: [...readersOf(slop.agents), "Editor Assistant"] },
          {
            id: "platform-profiles",
            name: "Platform profiles",
            origin: "built_in" as const,
            note: clip(`Length, the cut before “more” and the tone for ${POST_PROFILES.map((p) => p.label).join(", ")} and video captions. No links; hashtags only on video captions.`, 200),
            readBy: ["Writer", "Checker"],
          },
        ],
        video: [
          ...readyStyles().map((style) => ({ id: `style-${style.name}`, name: style.name, origin: "built_in" as const, note: clip(style.description, 200), readBy: ["Studio", "Editor Assistant"] as ("Studio" | "Editor Assistant")[] })),
          ...own.map((skill) => ({ id: skill.id, name: skill.name.slice(0, 80), origin: "yours" as const, note: clip(`${skill.description} · saved ${shortDate(skill.created_at)}`, 200), readBy: ["Editor Assistant"] as "Editor Assistant"[] })),
        ],
      };
    },
    site: async () => {
      const r = await supabase.from("cmo_runs").select("input").eq("kind", "onboard").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (r.error) throw new Error(`cmo_runs: ${r.error.message}`);
      const site = (r.data as { input?: { site?: string } } | null)?.input?.site;
      return typeof site === "string" ? site.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 200) : null;
    },
    documents: async () => {
      const rows = must(await supabase.from("marketing_documents_latest").select("kind, created_by, created_at"), "marketing_documents_latest") as {
        kind: DocumentKind;
        created_by: "agent" | "user";
        created_at: string;
      }[];
      return DOCUMENT_KINDS.flatMap((kind) => {
        const row = rows.find((r) => r.kind === kind);
        if (!row) return [];
        const doc = DOCUMENTS[kind];
        return [{ kind, title: doc.title, summary: doc.summary.slice(0, 300), fields: doc.fields.length, editedBy: row.created_by, editedAt: new Date(row.created_at).toISOString(), note: null }];
      });
    },
    brandKits: async () => {
      const rows = must(await supabase.from("brand_kits").select("id, name, kit, is_default").order("created_at").limit(20), "brand_kits") as {
        id: string;
        name: string;
        kit: BrandKitJson | null;
      }[];
      return Promise.all(
        rows.map(async (row) => {
          const k = row.kit ?? {};
          const logo = k.logo && typeof k.logo.object === "string" ? { ...k.logo, object: k.logo.object } : null;
          const signed = logo ? await supabase.storage.from("brand").createSignedUrl(logo.object, 3600) : null;
          return {
            id: row.id,
            name: row.name.slice(0, 60),
            colors: k.colors!,
            fonts: { heading: String(k.fonts?.heading ?? "Inter"), body: String(k.fonts?.body ?? "Inter") },
            captionStyle: String(k.captions?.preset ?? "classic"),
            aspect: k.layout?.aspect ?? "9:16",
            fit: k.layout?.fit ?? "fill",
            logo: logo ? { url: signed?.data?.signedUrl ?? null, corner: logo.corner ?? "top-right", size: logo.size ?? 0.08 } : null,
          };
        }),
      );
    },
  });
}

/** The parts of a stored kit (`brand_kits.kit`, checked by `save_brand_kit`) the Library shows. */
type BrandKitJson = {
  colors?: LibraryScreen["brandKits"][number]["colors"];
  fonts?: { heading?: string; body?: string };
  captions?: { preset?: string };
  layout?: { aspect?: LibraryScreen["brandKits"][number]["aspect"]; fit?: LibraryScreen["brandKits"][number]["fit"] };
  logo?: { object?: string; corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right"; size?: number } | null;
};

async function settings({ supabase, userId }: LoadContext): Promise<Partial<SettingsScreen>> {
  const prof = profile(supabase, userId);
  return parts<SettingsScreen>("settings", {
    accounts: async () => accountList(await socialAccounts(supabase), true),
    cmo: () => cmoState(prof),
    weeklyCreditBudget: async () => (await prof).weekly_credit_budget,
    timezone: async () => (await prof).timezone,
    digestHour: async () => (await prof).digest_hour,
    // Wave 2 B2: own reads, like autopilot's, so the shared profile read does not depend on this migration.
    digestDays: async () => {
      const r = await supabase.from("profiles").select("digest_days").eq("id", userId).maybeSingle<{ digest_days: string | null }>();
      if (r.error) throw new Error(`profiles: ${r.error.message}`);
      return DIGEST_DAYS.find((d) => d === r.data?.digest_days) ?? "weekdays";
    },
    emailLog: async () => {
      const r = await supabase.rpc("my_email_log", { p_limit: 30 });
      if (r.error) throw new Error(`my_email_log: ${r.error.message}`);
      const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
      type Row = { id: string; kind: string; day: string; status: string; subject: string | null; summary: Record<string, unknown> | null; created_at: string; sent_at: string | null };
      return ((r.data ?? []) as Row[]).flatMap((row): SettingsScreen["emailLog"] => {
        const kind = (["digest", "weekly", "push", "expiring"] as const).find((k) => k === row.kind);
        const status = row.status === "sent" || row.status === "skipped" ? row.status : null;
        if (!kind || !status) return [];
        const s = row.summary;
        return [{
          id: row.id,
          kind,
          day: String(row.day).slice(0, 10),
          status,
          subject: row.subject ? row.subject.slice(0, 200) : null,
          summary: s && typeof s === "object"
            ? { people: count(s.people), followUps: count(s.followUps), posts: count(s.posts), ...(typeof s.note === "string" ? { note: s.note.slice(0, 200) } : {}) }
            : null,
          at: iso(row.sent_at ?? row.created_at) ?? new Date(0).toISOString(),
        }];
      });
    },
    // Its own read: `profile()` feeds every screen, and must not fail on a database that has not had this migration.
    autopilot: async () => {
      const r = await supabase.from("profiles").select("autopilot_platforms, autopilot_hours, autopilot_note, autopilot_paused").eq("id", userId).maybeSingle();
      if (r.error || !r.data) throw new Error(`profiles: ${r.error?.message ?? "missing"}`);
      const p = r.data as { autopilot_platforms: string[] | null; autopilot_hours: number | null; autopilot_note: string | null; autopilot_paused: boolean | null };
      const hours = AUTOPILOT_HOURS.find((h) => h === p.autopilot_hours) ?? 12;
      return {
        platforms: AUTOPILOT_PLATFORMS.filter((id) => (p.autopilot_platforms ?? []).includes(id)),
        hours,
        note: p.autopilot_note,
        paused: p.autopilot_paused === true,
      };
    },
    plan: async () => {
      const [p, balance] = await Promise.all([prof, supabase.rpc("credit_balance", { p_user_id: userId })]);
      const name = p.plan.charAt(0).toUpperCase() + p.plan.slice(1);
      return { name: name.slice(0, 40), credits: typeof balance.data === "number" ? balance.data : null };
    },
  });
}

type SocialAccountDb = { id: string; platform: string; handle: string; avatar_url: string | null; status: string; updated_at: string };

/** The founder's connected platforms, or null when the read failed (rows then say nothing either way). */
async function connectedSet(supabase: SupabaseClient): Promise<Set<string> | null> {
  const { data, error } = await supabase.from("social_accounts").select("platform, status").eq("status", "connected");
  return error ? null : connectedPlatforms((data ?? []) as { platform: string; status: string }[]);
}

async function socialAccounts(supabase: SupabaseClient): Promise<SocialAccountDb[]> {
  return must(
    await supabase.from("social_accounts").select("id, platform, handle, avatar_url, status, updated_at").order("connected_at"),
    "social_accounts",
  ) as SocialAccountDb[];
}

/**
 * Every platform Ferreto posts to, connected or not (P4 F1): Settings offers Connect for the rest. `reconnect` when
 * Zernio reports the account refused or gone; then posts to it wait until the founder connects it again.
 */
function accountList(rows: SocialAccountDb[], all: boolean): SettingsScreen["accounts"] {
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));
  return PUBLISH_PLATFORMS.flatMap((platform): SettingsScreen["accounts"] => {
    const r = byPlatform.get(platform);
    // An old TikTok or Instagram account still shows (to disconnect it); a missing one is not offered.
    if (!r && !(CONNECTABLE_PLATFORMS as readonly string[]).includes(platform)) return [];
    if (!r) return all ? [{ id: `connect-${platform}`, platform, handle: "", status: "not_connected" as const, syncedAt: null, noDataSince: null, avatarUrl: null }] : [];
    const connected = r.status === "connected";
    return [{
      id: r.id,
      platform,
      handle: r.handle.slice(0, 80),
      status: connected ? ("connected" as const) : ("reconnect" as const),
      syncedAt: connected ? iso(r.updated_at) : null,
      noDataSince: connected ? null : iso(r.updated_at),
      avatarUrl: r.avatar_url,
    }];
  });
}

type SlotDb = {
  id: string;
  platform: string;
  status: string;
  publish_at: string;
  error: { message?: string } | null;
  external_url: string | null;
  approval_id: string | null;
  account: { handle: string } | null;
  deliverable: { kind: string; ref_kind: string; ref_id: string } | null;
};

/** SQL's slot statuses on the calendar's five (`SLOT_STATUSES`); a card still waiting makes it the founder's turn. */
function slotStatus(s: SlotDb, waiting: Set<string>): { status: ScheduleScreen["slots"][number]["status"]; note: string | null } {
  switch (s.status) {
    case "proposed":
      return { status: s.approval_id && waiting.has(s.approval_id) ? "waiting_founder" : "proposed", note: null };
    case "waiting":
    case "due":
    case "publishing":
      return { status: "scheduled", note: null };
    case "reminded":
      return { status: "scheduled", note: "post it yourself" };
    case "published":
      return { status: "posted", note: null };
    case "missed":
      return { status: "failed", note: "missed" };
    default:
      return { status: "failed", note: s.error?.message ? s.error.message.slice(0, 80) : "failed" };
  }
}

const SCHEDULE_RULES: string[] = [
  `At most ${scheduleDefaults.platforms.x.dailyCap} posts a day on X; on other platforms as many as their best times. ${scheduleDefaults.minGapHours} hours apart.`,
  "Times start from common best times (Buffer's 2026 study) in your time zone. Once a platform has 10 published posts with numbers, your own best hours take over.",
  "A short and its long video never go out on one platform the same day.",
  "Drag a slot to move it. A new time or account asks you again.",
  `A post that misses its time by ${scheduleDefaults.windowMinutes} minutes is never posted late: you get a new time to approve.`,
];

async function schedule({ supabase, userId, params }: LoadContext): Promise<Partial<ScheduleScreen>> {
  const prof = profile(supabase, userId);
  // The week starts at Monday midnight where the founder is: a Monday 06:00 post in UTC+7 is Monday's, not Sunday's.
  // A profile that cannot be read leaves the timezone field to fail on its own, as each field does.
  const timezone = await prof.then((p) => p.timezone, () => "UTC");
  const asked = params.get("from");
  const askedDay = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && !Number.isNaN(Date.parse(`${asked}T12:00:00Z`)) ? asked : null;
  const monday = askedDay ? localMonday(Date.parse(`${askedDay}T12:00:00Z`), "UTC") : localMonday(Date.now(), timezone);
  // `?range=month`: the Calendar's Month view draws four weeks, so it reads four (it read one, and weeks 2-4 were empty).
  const days = params.get("range") === "month" ? 28 : 7;
  const nextMonday = new Date(Date.parse(`${monday}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const from = new Date(localMidnight(monday, timezone) ?? `${monday}T00:00:00Z`);
  const to = new Date(localMidnight(nextMonday, timezone) ?? `${nextMonday}T00:00:00Z`);
  // One read of the accounts for the list and the plan's default (connected text platforms at one a day).
  const accounts = socialAccounts(supabase);
  return parts<ScheduleScreen>("schedule", {
    timezone: async () => (await prof).timezone,
    from: async () => from.toISOString(),
    to: async () => to.toISOString(),
    slots: async () => scheduleSlots(supabase, from, to),
    accounts: async () => accountList(await accounts, false),
    rules: async () => SCHEDULE_RULES,
    postingPlan: async () => {
      const [saved, rows, postPlan] = await Promise.all([
        supabase.from("profiles").select("posting_plan").eq("id", userId).maybeSingle<{ posting_plan: unknown }>(),
        accounts,
        supabase.from("marketing_documents_latest").select("body").eq("kind", "post_plan").maybeSingle<{ body: unknown }>(),
      ]);
      if (saved.error) throw new Error(`profiles: ${saved.error.message}`);
      // The chosen channels only fill the default: a read that fails means none, never a failed screen.
      return planOrDefault(saved.data?.posting_plan, rows.filter((r) => r.status === "connected").map((r) => r.platform), chosenChannels(postPlan.error ? undefined : postPlan.data?.body));
    },
  });
}

/**
 * The founder's slots between two instants, as Schedule draws them: title, account, status and the waiting card. One
 * read for Schedule and the Dashboard's "Going out today" (review follow-up Q1), so both say the same thing.
 */
async function scheduleSlots(supabase: SupabaseClient, from: Date, to: Date): Promise<ScheduleScreen["slots"]> {
  const slots = must(
    await supabase
      .from("schedule_slots")
      .select("id, platform, status, publish_at, error, external_url, approval_id, account:social_accounts(handle), deliverable:deliverables(kind, ref_kind, ref_id)")
      .gte("publish_at", from.toISOString())
      .lt("publish_at", to.toISOString())
      .neq("status", "cancelled")
      .order("publish_at")
      .limit(300),
    "schedule_slots",
  ) as unknown as SlotDb[];
  const items = [...new Set(slots.flatMap((s) => (s.deliverable?.ref_kind === "content_item" ? [s.deliverable.ref_id] : [])))];
  const clips = [...new Set(slots.flatMap((s) => (s.deliverable?.ref_kind === "clip" ? [s.deliverable.ref_id] : [])))];
  const approvals = [...new Set(slots.flatMap((s) => (s.approval_id ? [s.approval_id] : [])))];
  const [itemRows, clipRows, waitingRows, connected] = await Promise.all([
    items.length ? supabase.from("content_items").select("id, idea, body").in("id", items) : Promise.resolve({ data: [] }),
    clips.length ? supabase.from("clips").select("id, hook").in("id", clips) : Promise.resolve({ data: [] }),
    approvals.length ? supabase.from("approvals").select("id").in("id", approvals).eq("status", "waiting") : Promise.resolve({ data: [] }),
    slots.length ? connectedSet(supabase) : Promise.resolve(null),
  ]);
  const titles = new Map<string, string>([
    ...((itemRows.data ?? []) as { id: string; idea: string | null; body: { text?: string } | null }[]).map(
      (r) => [r.id, (r.body?.text?.split("\n")[0] || r.idea || "Post").slice(0, 300)] as [string, string],
    ),
    ...((clipRows.data ?? []) as { id: string; hook: string | null }[]).map((r) => [r.id, r.hook || "Untitled"] as [string, string]),
  ]);
  const waiting = new Set(((waitingRows.data ?? []) as { id: string }[]).map((r) => r.id));
  return slots.flatMap((s) => {
    const platform = PUBLISH_PLATFORMS.find((p) => p === s.platform);
    if (!platform) return [];
    const { status, note } = slotStatus(s, waiting);
    return [{
      id: s.id,
      at: iso(s.publish_at)!,
      where: { platform, handle: (s.account?.handle ?? "").slice(0, 80) },
      // A short is cut from a finished edit; anything else from a clip is the founder's video (or slideshow).
      title: (s.deliverable?.ref_kind === "clip"
        ? `${s.deliverable.kind === "short" ? "Short" : "Video"} · ${titles.get(s.deliverable.ref_id) ?? "Untitled"}`
        : (titles.get(s.deliverable?.ref_id ?? "") ?? "Post")).slice(0, 300),
      status,
      note,
      // A card still waiting (a time to approve, a failed post's Retry, a copy-and-open) opens from its slot.
      approvalId: s.approval_id && waiting.has(s.approval_id) ? s.approval_id : null,
      url: status === "posted" && s.external_url?.startsWith("https://") ? s.external_url : null,
      ...(connected ? { connected: connected.has(platform) } : {}),
    }];
  });
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The rows Studio's cards decide, per order: its steps, its shorts batches and its video's edit (card 3). */
async function studioRefs(supabase: SupabaseClient, orderIds: string[]): Promise<{ order_id: string; ref_id: string }[]> {
  const [steps, batches] = await Promise.all([
    supabase.from("studio_steps").select("id, order_id, clip_id").in("order_id", orderIds),
    supabase.from("short_batches").select("id, order_id").in("order_id", orderIds),
  ]);
  const stepRows = must(steps, "studio_steps") as { id: string; order_id: string; clip_id: string }[];
  return [
    ...stepRows.map((r) => ({ order_id: r.order_id, ref_id: r.id })),
    ...[...new Map(stepRows.map((r) => [r.clip_id, r.order_id])).entries()].map(([clip, order]) => ({ order_id: order, ref_id: clip })),
    ...(must(batches, "short_batches") as { id: string; order_id: string }[]).map((r) => ({ order_id: r.order_id, ref_id: r.id })),
  ];
}

type StepDb = VideoStepRow & { id: string; order_id: string; clip_id: string; created_at: string };
const STEP_COLUMNS = "id, order_id, clip_id, tool, kind, status, decision, card, next, next_done_at, created_at";

/** Each video order's team steps, oldest step first. */
async function videoStepsByOrder(supabase: SupabaseClient, orders: { id: string; status: string }[]): Promise<Map<string, TeamStep[]>> {
  const out = new Map<string, TeamStep[]>();
  if (!orders.length) return out;
  const ids = orders.map((o) => o.id);
  const [steps, card3] = await Promise.all([
    supabase.from("studio_steps").select(STEP_COLUMNS).in("order_id", ids).order("created_at", { ascending: true }),
    supabase.from("approvals").select("ref_id").eq("ref_kind", "editor_project").eq("status", "waiting"),
  ]);
  const rows = must(steps, "studio_steps") as StepDb[];
  const waiting = new Set((must(card3, "approvals") as { ref_id: string }[]).map((r) => r.ref_id));
  for (const o of orders) {
    const mine = rows.filter((r) => r.order_id === o.id);
    out.set(o.id, videoSteps(o as { status: OrderDb["status"] }, mine, mine.some((r) => waiting.has(r.clip_id))));
  }
  return out;
}

const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S+$/.test(u) && u.length <= 500;

/** Waiting cards keyed by the row they decide. */
async function waitingByRef(supabase: SupabaseClient, refKind: string): Promise<Map<string, string>> {
  const rows = must(await supabase.from("approvals").select("id, ref_id").eq("ref_kind", refKind).eq("status", "waiting"), "approvals") as {
    id: string;
    ref_id: string;
  }[];
  return new Map(rows.map((r) => [r.ref_id, r.id]));
}

type LiveCard = { id: string; status: "waiting" | "held"; heldUntil: string | null };

/**
 * Live cards (waiting or held past the day's card budget) keyed by the row they decide. Writer needs both: a held card
 * is not in the queue, so its row offers "Show it now" instead of opening a card that is not there.
 */
async function liveByRef(supabase: SupabaseClient, refKind: string): Promise<Map<string, LiveCard>> {
  const rows = must(
    await supabase.from("approvals").select("id, ref_id, status, held_until").eq("ref_kind", refKind).in("status", ["waiting", "held"]),
    "approvals",
  ) as { id: string; ref_id: string; status: "waiting" | "held"; held_until: string | null }[];
  return new Map(rows.map((r) => [r.ref_id, { id: r.id, status: r.status, heldUntil: iso(r.held_until) }]));
}

async function research({ supabase }: LoadContext): Promise<Partial<ResearchScreen>> {
  const now = new Date();
  const latest = supabase.from("cmo_insights").select("body, created_at").eq("kind", "competitors").order("created_at", { ascending: false }).limit(1).maybeSingle();
  // P5 R2: what works on video in the founder's niche, the newest run.
  const niche = supabase.from("cmo_insights").select("body, created_at").eq("kind", "niche_video").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return parts<ResearchScreen>("research", {
    lastRunAt: async () => {
      const r = await supabase.from("cmo_runs").select("finished_at").in("kind", ["competitor_research", "niche_video_research"]).eq("status", "done").order("finished_at", { ascending: false }).limit(1).maybeSingle();
      if (r.error) throw new Error(`cmo_runs: ${r.error.message}`);
      return iso((r.data as { finished_at: string | null } | null)?.finished_at);
    },
    // The research loop runs on Sunday's 00:05 UTC schedule.
    nextRunAt: async () => {
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ((7 - now.getUTCDay()) % 7), 0, 5));
      if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
      return next.toISOString();
    },
    insights: async () => {
      const [r, n] = await Promise.all([latest, niche]);
      if (r.error) throw new Error(`cmo_insights: ${r.error.message}`);
      if (n.error) throw new Error(`cmo_insights: ${n.error.message}`);
      type NicheRow = { platform?: string; url?: string; hook?: string; format?: string; why?: string; views?: number; lift?: number };
      const videos = (((n.data as { body?: { videos?: NicheRow[] } } | null)?.body?.videos ?? []) as NicheRow[])
        .filter((v) => typeof v.hook === "string" && v.hook && isHttps(v.url))
        .slice(0, 12)
        .map((v, i) => ({
          id: `video-${i}`,
          type: "hook" as const,
          scope: "niche_video" as const,
          platform: v.platform === "youtube" ? "Shorts" : "TikTok",
          text: v.hook!.slice(0, 300),
          evidence: [typeof v.lift === "number" ? `${v.lift}× the search's median` : "", v.format ?? "", v.why ?? ""].filter(Boolean).join(" · ").slice(0, 200),
          usedIn: null,
          sources: [v.url!],
          video: {
            views: typeof v.views === "number" ? Math.max(0, Math.round(v.views)) : null,
            outlier: typeof v.lift === "number" ? v.lift : null,
            seconds: null,
            format: v.format ? v.format.slice(0, 60) : null,
          },
        }));
      const body = ((r.data as { body?: { hooks?: unknown[] } } | null)?.body ?? {}) as { hooks?: { pattern?: string; example?: string; url?: string; lift?: number }[] };
      // Every insight points to the post it came from: one without a link is dropped (counted in `dropped`).
      const hooks: ResearchScreen["insights"] = (body.hooks ?? [])
        .filter((h) => typeof h.pattern === "string" && h.pattern && isHttps(h.url))
        .slice(0, 20)
        .map((h, i) => ({
          id: `hook-${i}`,
          type: "hook" as const,
          scope: "competitors" as const,
          platform: "X",
          text: h.pattern!.slice(0, 300),
          evidence: `${typeof h.lift === "number" ? `${h.lift}× the account's median` : "Above the account's median"}${h.example ? ` · “${h.example.slice(0, 120)}”` : ""}`.slice(0, 200),
          usedIn: null,
          sources: [h.url!],
        }));
      return [...hooks, ...videos];
    },
    dropped: async () => {
      const r = await latest;
      if (r.error) throw new Error(`cmo_insights: ${r.error.message}`);
      const body = ((r.data as { body?: unknown } | null)?.body ?? {}) as { hooks?: { url?: unknown }[]; formats?: unknown[]; ideas?: unknown[] };
      return (body.hooks ?? []).filter((h) => !isHttps(h.url)).length + (body.formats ?? []).length + (body.ideas ?? []).length;
    },
    competitors: async () => {
      const since = new Date(now.getTime() - 8 * 7 * 86_400_000).toISOString().slice(0, 10);
      const [rows, mentions] = await Promise.all([
        supabase.from("competitors").select("id, name, site, logo_url, price, offer, added_via").order("created_at", { ascending: false }).limit(20),
        supabase.from("my_competitor_mentions").select("competitor_id, week, mentions").gte("week", since).order("week").limit(200),
      ]);
      const list = must(rows, "competitors") as { id: string; name: string; site: string; logo_url: string | null; price: string | null; offer: string | null; added_via: "url" | "chat" }[];
      const counts = must(mentions, "my_competitor_mentions") as { competitor_id: string; week: string; mentions: number }[];
      return list.map((c) => ({
        id: c.id,
        name: c.name,
        site: c.site,
        logoUrl: isHttps(c.logo_url) ? c.logo_url : null,
        price: c.price,
        offer: c.offer,
        addedVia: c.added_via,
        mentions: counts.filter((m) => m.competitor_id === c.id).slice(-8).map((m) => ({ week: m.week, count: m.mentions })),
      }));
    },
    results: async () => {
      const metrics = must(await supabase.from("post_metrics").select("item_id, views, replies, measured_at").order("measured_at", { ascending: false }).limit(100), "post_metrics") as {
        item_id: string;
        views: number | null;
        replies: number | null;
      }[];
      const latestPerItem = [...new Map(metrics.map((m) => [m.item_id, m])).values()].slice(0, 10);
      if (!latestPerItem.length) return [];
      const items = must(await supabase.from("content_items").select("id, idea, final_text, platform").in("id", latestPerItem.map((m) => m.item_id)), "content_items") as {
        id: string;
        idea: string;
        final_text: string | null;
        platform: string | null;
      }[];
      return latestPerItem.map((m) => {
        const item = items.find((i) => i.id === m.item_id);
        // P6 measures Threads, LinkedIn and video posts too, not only X.
        return { id: m.item_id, title: (item?.final_text ?? item?.idea ?? "Your post").slice(0, 200), platform: screenPlatform(item?.platform, "x"), views: orNull(m.views), replies: orNull(m.replies) };
      });
    },
  });
}

/** The screen platform of a calendar label or profile id ("LinkedIn" → linkedin, "tiktok_caption" → tiktok). */
function screenPlatform(label: string | null | undefined, fallback: WriterScreen["drafts"][number]["platform"]): WriterScreen["drafts"][number]["platform"] {
  return profileOf(profileIdOf(label) ?? "")?.platform ?? fallback;
}

/**
 * The thread addresses of a draft's sources (its own opportunities, under RLS), so the card links them. A web address
 * only; a read that fails loses the links, never the drafts.
 */
async function sourceLinks(supabase: LoadContext["supabase"], ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 300);
  if (!wanted.length) return new Map();
  const { data, error } = await supabase.from("opportunities").select("id, url").in("id", wanted);
  if (error) return new Map();
  return new Map(((data ?? []) as { id: string; url: string | null }[]).flatMap((o) => (o.url && /^https?:\/\//i.test(o.url) && o.url.length <= 2000 ? [[o.id, o.url] as const] : [])));
}

async function writer({ supabase, userId }: LoadContext): Promise<Partial<WriterScreen>> {
  const index = indexOf(supabase);
  const prof = profile(supabase, userId);
  return parts<WriterScreen>("writer", {
    timezone: async () => (await prof).timezone,
    // Posts on their own platform, captions per platform (P3 A2: video words for one edit), and the briefs Writer
    // wrote for Studio, over the last two weeks.
    drafts: async () => {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      type ItemRow = {
        id: string;
        day: string;
        idea: string;
        platform: string;
        status: "planned" | "drafting" | "in_review" | "approved" | "published";
        body: { text?: string; title?: string; alternates?: unknown[]; edited_at?: string };
        final_text: string | null;
        published_at: string | null;
        clip_id: string | null;
      };
      const columns = "id, day, idea, platform, status, body, final_text, published_at, clip_id";
      const statuses = ["planned", "drafting", "in_review", "approved", "published"];
      const [posts, captions, cards, videoCards, batchCards, shorts, slotTimes, videoSlots, slotCards] = await Promise.all([
        supabase.from("content_items").select(columns).eq("department", "post").in("status", statuses).gte("day", since).order("day").limit(100),
        supabase.from("content_items").select(columns).eq("department", "video").not("clip_id", "is", null).in("status", statuses).gte("day", since).order("day").limit(60),
        liveByRef(supabase, "content_item"),
        liveByRef(supabase, "editor_project"),
        liveByRef(supabase, "short_batch"),
        supabase.from("shorts").select("short_clip_id, batch_id").not("short_clip_id", "is", null).gte("created_at", `${since}T00:00:00Z`).limit(200),
        // The time an approved post goes out: its slot's, not only the day the plan gave it. The slot's id comes with it,
        // so the row's "Scheduled" button can move that time (`change_time`) without a trip to the Calendar.
        supabase.from("schedule_slots").select("id, publish_at, deliverable:deliverables(ref_kind, ref_id)").in("status", ["waiting", "due", "publishing", "reminded"]).gte("publish_at", `${since}T00:00:00Z`).order("publish_at").limit(200),
        // A video goes out one card per platform (owner, 2026-11-13): each caption's row follows its platform's slot.
        supabase.from("schedule_slots").select("platform, status, publish_at, published_at, approval_id, error, created_at, deliverable:deliverables!inner(ref_kind, ref_id)").eq("deliverable.ref_kind", "clip").neq("status", "cancelled").gte("created_at", `${since}T00:00:00Z`).order("created_at").limit(200),
        supabase.from("approvals").select("id").eq("ref_kind", "schedule_slot").eq("status", "waiting").limit(200),
      ]);
      // A read that fails here only loses the exact time; the row keeps its day.
      const goesOut = new Map<string, string>();
      const slotOf = new Map<string, string>();
      for (const slot of ((slotTimes.data ?? []) as unknown as { id: string; publish_at: string; deliverable: { ref_kind: string; ref_id: string } | null }[])) {
        if (slot.deliverable?.ref_kind !== "content_item" || goesOut.has(slot.deliverable.ref_id)) continue;
        goesOut.set(slot.deliverable.ref_id, slot.publish_at);
        slotOf.set(slot.deliverable.ref_id, slot.id);
      }
      const column = { planned: "planned", drafting: "drafting", in_review: "waiting", approved: "scheduled", published: "posted" } as const;
      // A draft in review whose card is not in the queue: held past the day's budget, or gone (cancelled, never raised
      // again). The row still opens, with "Show it now" (`approval_show_now`) instead of a card that is not there.
      const cardOf = (status: ItemRow["status"], card: LiveCard | null | undefined) =>
        status !== "in_review"
          ? { cardState: null, heldUntil: null, approvalId: null }
          : card?.status === "waiting"
            ? { cardState: "waiting" as const, heldUntil: null, approvalId: card.id }
            : card
              ? { cardState: "held" as const, heldUntil: card.heldUntil, approvalId: null }
              : { cardState: "missing" as const, heldUntil: null, approvalId: null };
      const dayText = (day: string) => WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]!;
      const batchOf = new Map((must(shorts, "shorts") as { short_clip_id: string; batch_id: string }[]).map((s) => [s.short_clip_id, s.batch_id]));
      const postRows = must(posts, "content_items") as ItemRow[];
      const [connected, links, { people, posts: postNo }] = await Promise.all([
        connectedSet(supabase),
        sourceLinks(supabase, postRows.flatMap((r) => storedSources(r.body as Record<string, unknown>).map((s) => s.opportunityId))),
        index,
      ]);
      // A core post goes to every platform of its slot (`body.targets`): it goes out on its own only when all are connected.
      const targetsOf = new Map(postRows.map((r) => {
        const raw = (r.body as { targets?: unknown }).targets;
        return [r.id, Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : []] as const;
      }));
      const postDrafts = postRows.map((r) => {
        const text = typeof r.body.text === "string" && r.body.text ? r.body.text : r.idea;
        const edited = r.final_text !== null && r.final_text !== r.body.text;
        return {
          id: r.id,
          ...(postNo.has(r.id) ? { no: postNo.get(r.id)! } : {}),
          kind: "post" as const,
          platform: screenPlatform(r.platform, "x"),
          at: iso(r.published_at ?? (r.status === "approved" ? (goesOut.get(r.id) ?? null) : null)),
          dayText: r.published_at || (r.status === "approved" && goesOut.has(r.id)) ? null : dayText(r.day),
          day: r.day.slice(0, 10),
          title: (r.final_text ?? text).slice(0, 300),
          column: column[r.status],
          versions: Math.min(3, Math.max(1, 1 + (Array.isArray(r.body.alternates) ? r.body.alternates.length : 0))),
          note: r.status === "published" || r.status === "approved" ? (edited ? "You edited it before approving" : "Approved as drafted") : null,
          ...cardOf(r.status, cards.get(r.id)),
          slotId: r.status === "approved" ? (slotOf.get(r.id) ?? null) : null,
          ref: { kind: "content_item" as const, id: r.id },
          text: (r.final_text ?? text).slice(0, 5000),
          sources: storedSources(r.body as Record<string, unknown>).map((src) => ({ ...src, url: links.get(src.opportunityId) ?? null, ref: people.get(src.opportunityId) ?? null })),
        };
      });
      type VideoSlot = { platform: string; status: string; publish_at: string; published_at: string | null; approval_id: string | null; error: { message?: string } | null; deliverable: { ref_kind: string; ref_id: string } };
      // The newest slot of each video on each platform: a missed one is followed by its new time.
      const slotOfCaption = new Map<string, VideoSlot>();
      for (const slot of (videoSlots.data ?? []) as unknown as VideoSlot[]) slotOfCaption.set(`${slot.deliverable.ref_id}:${slot.platform}`, slot);
      const asking = new Set(((slotCards.data ?? []) as { id: string }[]).map((c) => c.id));
      const captionDrafts = (must(captions, "content_items") as ItemRow[]).map((r) => {
        const platform = screenPlatform(r.platform, "tiktok");
        const title = (typeof r.body.title === "string" && r.body.title ? r.body.title : typeof r.body.text === "string" ? r.body.text : r.idea).slice(0, 300);
        const slot = slotOfCaption.get(`${r.clip_id}:${platform}`);
        if (slot) {
          // Its platform's card decides the caption with the time: the row says where that stands, at the slot's time.
          const card = slot.approval_id && asking.has(slot.approval_id) ? slot.approval_id : null;
          const failed = slot.status === "failed" || slot.status === "missed";
          const column = slot.status === "published" ? ("posted" as const) : slot.status === "proposed" || (failed && card) ? ("waiting" as const) : ("scheduled" as const);
          return {
            id: r.id,
            kind: "caption" as const,
            platform,
            at: iso(slot.published_at ?? slot.publish_at),
            dayText: null,
            day: r.day.slice(0, 10),
            title,
            column,
            versions: 1,
            note: failed ? (slot.error?.message ?? "It did not go out").slice(0, 120) : slot.status === "proposed" ? "Approve it on its card" : r.body.edited_at ? "You edited it on its card" : null,
            cardState: column === "waiting" && card ? ("waiting" as const) : null,
            heldUntil: null,
            approvalId: card,
            ref: null,
            text: null,
          };
        }
        const batch = batchOf.get(r.clip_id!);
        const videoCard = videoCards.get(r.clip_id!);
        const card = videoCard ?? (batch ? batchCards.get(batch) : undefined) ?? null;
        // A caption has no card of its own: it is decided on its video's (or its batch's) card.
        const ref = videoCard ? { kind: "editor_project" as const, id: r.clip_id! } : batch ? { kind: "short_batch" as const, id: batch } : null;
        return {
          id: r.id,
          kind: "caption" as const,
          platform,
          at: iso(r.published_at),
          dayText: r.published_at ? null : dayText(r.day),
          day: r.day.slice(0, 10),
          title,
          column: column[r.status],
          versions: 1,
          note: r.body.edited_at ? "You edited it on the card" : r.status === "in_review" ? "On the video's card" : null,
          // Only a held card can be shown now: a caption without one waits on its video, not on a card to raise.
          ...(card?.status === "held" ? cardOf(r.status, card) : { cardState: card && r.status === "in_review" ? ("waiting" as const) : null, heldUntil: null, approvalId: card?.status === "waiting" ? card.id : null }),
          ref,
          text: null,
        };
      });
      const postsConnected = withConnected(postDrafts.map((d) => ({ ...d, targets: targetsOf.get(d.id) ?? [] })), connected).map(({ targets: _targets, ...d }) => d);
      return [...postsConnected, ...captionDrafts];
    },
    // What Writer reads first: the rules the founder approved, then their heaviest voice notes; the product rule.
    voice: async () => {
      const [rules, notes, words] = await Promise.all([
        supabase.from("cmo_corrections").select("rule, created_at, decided_at").eq("status", "active").order("created_at", { ascending: false }).limit(10),
        voiceNotes(supabase, 8),
        wordsCut(supabase),
      ]);
      const label = (platform: string | null) => (platform ? (profileOf(platform)?.label ?? "") : "");
      return {
        lines: [
          ...(must(rules, "cmo_corrections") as { rule: string; created_at: string; decided_at: string | null }[]).map((r) => ({
            text: clip(r.rule, 200),
            source: `Rule you approved · ${shortDate(r.decided_at ?? r.created_at)}`,
          })),
          ...notes.map((n) => ({
            text: clip(n.body, 200),
            source: clip([voiceSource(n), label(n.platform), `weight ${n.weight.toFixed(2)}`].filter(Boolean).join(" · "), 120),
          })),
          { text: "No links, no hashtags in posts.", source: "Product rule · hashtags only on video captions" },
        ],
        wordsCut: words,
      };
    },
  });
}

/**
 * Studio (P2 A5): the long videos the brain's orders make and the shorts batches, with their cards; the Video team
 * panel for the video in progress; and every recent edit's finished state (`editStates`), which the page puts on the
 * upload cards it reads from `/api/v1/projects`. Uploads themselves stay on that route.
 */
/** Longest a vertical edit runs and still counts as a short (the platforms' cap for Shorts, Reels and TikTok). */
const SHORT_MAX_SECONDS = 60;

/** A vertical frame whose work area is a minute or less: the founder made a short, whatever the edit is called. */
export function isShortFrame(edit: { frame_w: unknown; frame_h: unknown; workarea: unknown }): boolean {
  const { frame_w: w, frame_h: h, workarea } = edit;
  if (typeof w !== "number" || typeof h !== "number" || h <= w) return false;
  if (!Array.isArray(workarea) || typeof workarea[0] !== "number" || typeof workarea[1] !== "number") return false;
  const seconds = workarea[1] - workarea[0];
  return seconds > 0 && seconds <= SHORT_MAX_SECONDS;
}

async function studioScreen({ supabase }: LoadContext): Promise<Partial<StudioScreen>> {
  type VideoOrder = { id: string; title: string; status: OrderDb["status"]; created_at: string; updated_at: string; error: { message?: string } | null; brief: { seconds?: number } };
  type Edit = { clip_id: string; document_hash: string; finished_at: string | null; finished_hash: string | null; updated_at: string; clips: { kind: "full" | "blank" | "short" | "slideshow"; hook: string | null; created_at: string } | null; frame_w: unknown; frame_h: unknown; workarea: unknown };
  const videos = supabase
    .from("work_orders")
    .select("id, title, status, created_at, updated_at, error, brief")
    .eq("kind", "build_video")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(20)
    .then((r) => must(r, "work_orders") as VideoOrder[]);
  const edits = supabase
    .from("editor_projects")
    // The frame and work area sit on the document's root scene; read by path so the documents stay in the database.
    .select(
      "clip_id, document_hash, finished_at, finished_hash, updated_at, clips(kind, hook, created_at), frame_w:document->stage->children->0->width, frame_h:document->stage->children->0->height, workarea:document->stage->children->0->workarea",
    )
    .order("updated_at", { ascending: false })
    .limit(100)
    .then((r) => must(r, "editor_projects") as unknown as Edit[]);
  const steps = videos.then(async (orders) =>
    orders.length
      ? (must(await supabase.from("studio_steps").select(STEP_COLUMNS).in("order_id", orders.map((o) => o.id)).order("created_at", { ascending: true }), "studio_steps") as StepDb[])
      : [],
  );
  const cards = Promise.all([waitingByRef(supabase, "studio_step"), waitingByRef(supabase, "editor_project"), waitingByRef(supabase, "short_batch")]);

  return parts<StudioScreen>("studio", {
    items: async () => {
      const [orders, stepRows, editRows, [stepCards, editCards, batchCards]] = await Promise.all([videos, steps, edits, cards]);
      const editOf = new Map(editRows.map((e) => [e.clip_id, e]));
      const videoItems = orders.map((o) => {
        const mine = stepRows.filter((r) => r.order_id === o.id);
        const clipId = mine.at(-1)?.clip_id ?? null;
        const edit = clipId ? editOf.get(clipId) : undefined;
        const finished = !!edit?.finished_hash && edit.finished_hash === edit.document_hash;
        const waitingStep = mine.find((r) => stepCards.has(r.id));
        const approvalId = (waitingStep && stepCards.get(waitingStep.id)) ?? (clipId ? editCards.get(clipId) : undefined) ?? null;
        const status: StudioItem["status"] =
          o.status === "done" ? (finished ? "finished" : "ready") : o.status === "failed" ? "failed" : o.status === "waiting_founder" ? "waiting_founder" : "running";
        const seconds = typeof o.brief.seconds === "number" ? ` · ${o.brief.seconds} s` : "";
        const now = videoSteps(o, mine, !!(clipId && editCards.has(clipId))).find((s) => s.state === "running");
        return {
          id: o.id,
          kind: "video" as const,
          title: o.title.slice(0, 200),
          subtitle: `AI video${seconds}${status === "finished" ? " · finished" : now ? ` · ${now.label.toLowerCase()}` : ""}`.slice(0, 200),
          status,
          progress: null,
          favorite: false,
          createdAt: new Date(o.created_at).toISOString(),
          editedAt: edit ? new Date(edit.updated_at).toISOString() : null,
          failure: o.status === "failed" ? (o.error?.message ?? "The video could not be made.").slice(0, 200) : null,
          projectId: null,
          editorHref: clipId ? `/app/editor/${clipId}` : null,
          approvalId,
          // Only a built video is finished: once the order reached its render, Mark finished is card 3's approval.
          canMarkFinished: !!edit && !finished && o.status !== "failed" && (o.status === "done" || mine.some((r) => r.next?.tool === "render")),
          clipId,
          documentHash: edit?.document_hash ?? null,
          canCutShorts: finished,
          edits: [],
        };
      });

      const batches = must(
        await supabase.from("short_batches").select("id, parent_clip_id, status, error, created_at, decided_at, shorts(id, status)").order("created_at", { ascending: false }).limit(20),
        "short_batches",
      ) as { id: string; parent_clip_id: string; status: string; error: string | null; created_at: string; decided_at: string | null; shorts: { id: string; status: string }[] }[];
      const batchItems = batches.map((b) => {
        const parent = editOf.get(b.parent_clip_id)?.clips?.hook ?? "your video";
        const count = b.shorts.filter((x) => x.status !== "failed").length;
        const status: StudioItem["status"] =
          b.status === "approved" ? "finished" : b.status === "waiting_founder" ? "waiting_founder" : b.status === "failed" ? "failed" : b.status === "sent_back" || b.status === "cancelled" ? "cancelled" : "running";
        return {
          id: b.id,
          kind: "short" as const,
          title: `${count} ${count === 1 ? "short" : "shorts"} · ${parent}`.slice(0, 200),
          subtitle: (status === "running" ? "Cut from a finished edit · rendering" : status === "cancelled" ? "Sent back" : "Cut from a finished edit · 9:16").slice(0, 200),
          status,
          progress: null,
          favorite: false,
          createdAt: new Date(b.created_at).toISOString(),
          editedAt: iso(b.decided_at),
          failure: b.status === "failed" ? (b.error ?? "The shorts could not be rendered.").slice(0, 200) : null,
          projectId: null,
          editorHref: null,
          approvalId: batchCards.get(b.id) ?? null,
          canMarkFinished: false,
          clipId: null,
          documentHash: null,
          canCutShorts: false,
          edits: [],
        };
      });
      // The founder's own edits made in the editor (/video, New edit, slideshows, shorts): saved from the first save,
      // finished or not, so a video in progress is never only in an editor tab. Edits a work order or a shorts batch
      // made already have their card above; an upload's edit ("full") is on its upload card.
      const own = editRows.filter((e) => e.clips && e.clips.kind !== "full");
      const ownIds = own.map((e) => e.clip_id);
      const [stepClips, shortClips] = ownIds.length
        ? await Promise.all([
            supabase.from("studio_steps").select("clip_id").in("clip_id", ownIds).then((r) => must(r, "studio_steps") as { clip_id: string }[]),
            supabase.from("shorts").select("short_clip_id").in("short_clip_id", ownIds).then((r) => must(r, "shorts") as { short_clip_id: string }[]),
          ])
        : [[], []];
      const madeElsewhere = new Set([...stepClips.map((r) => r.clip_id), ...shortClips.map((r) => r.short_clip_id)]);
      const editItems = own
        .filter((e) => !madeElsewhere.has(e.clip_id))
        .map((e) => {
          const kind = e.clips!.kind === "slideshow" ? ("slideshow" as const) : e.clips!.kind === "short" || isShortFrame(e) ? ("short" as const) : ("video" as const);
          const finished = !!e.finished_hash && e.finished_hash === e.document_hash;
          const label = kind === "slideshow" ? "Slideshow" : kind === "short" ? "Short" : "Video";
          return {
            id: e.clip_id,
            kind,
            title: (e.clips!.hook?.trim() || `Untitled ${label.toLowerCase()}`).slice(0, 200),
            subtitle: `${label} · ${finished ? "finished" : "in progress, saved"}`,
            status: finished ? ("finished" as const) : ("ready" as const),
            progress: null,
            favorite: false,
            createdAt: new Date(e.clips!.created_at).toISOString(),
            editedAt: new Date(e.updated_at).toISOString(),
            failure: null,
            projectId: null,
            editorHref: `/app/editor/${e.clip_id}`,
            approvalId: editCards.get(e.clip_id) ?? null,
            canMarkFinished: !finished && kind === "video",
            clipId: e.clip_id,
            documentHash: e.document_hash,
            canCutShorts: finished && kind === "video",
            edits: [],
          };
        });
      return [...videoItems, ...batchItems, ...editItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    team: async () => {
      const [orders, stepRows, [, editCards]] = await Promise.all([videos, steps, cards]);
      const live = orders.find((o) => ["queued", "running", "waiting_founder", "waiting_order", "deferred"].includes(o.status));
      if (!live) return null;
      const mine = stepRows.filter((r) => r.order_id === live.id);
      const clip = mine.at(-1)?.clip_id;
      return { title: live.title.slice(0, 200), steps: videoSteps(live, mine, !!(clip && editCards.has(clip))) };
    },
    editStates: async () =>
      (await edits)
        .filter((e) => e.clips)
        .map((e) => ({
          clipId: e.clip_id,
          documentHash: e.document_hash,
          finishedAt: e.finished_hash === e.document_hash ? iso(e.finished_at) : null,
          kind: e.clips!.kind,
        })),
  });
}

/** A finished scan's `output` (`SalesScanOutput`) as the screen reads it; scans from before the contract get defaults. */
function toLastScan(output: unknown, at: string): SalesScan | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const places = (v: unknown) => SALES_PLATFORMS.filter((p) => Array.isArray(v) && v.includes(p));
  const cards = count(o.cards);
  return {
    cards,
    platforms: places(o.platforms),
    failed: places(o.failed),
    free: o.free === true,
    queries: (Array.isArray(o.queries) ? o.queries : []).filter((q): q is string => typeof q === "string" && q.trim() !== "").slice(0, 20).map((q) => q.trim().slice(0, 200)),
    scanned: count(o.scanned),
    verdict: o.verdict === "found" || o.verdict === "none" ? o.verdict : cards > 0 ? "found" : "none",
    at: new Date(at).toISOString(),
  };
}

/**
 * The Sales ↔ Post index (owner, 2026-11-25), read under RLS: Scan #n, person n.k, Post #m and which posts each person
 * fed. Each read is the newest page (the newest is #1), with only the columns the numbers need. Any read that fails or throws gives an empty index: rows show without
 * numbers rather than failing the screen.
 */
const EMPTY_INDEX = { scans: new Map<string, number>(), people: new Map<string, string>(), posts: new Map<string, number>(), usedIn: new Map<string, { no: number; id: string }[]>() };
async function indexOf(supabase: LoadContext["supabase"]): Promise<typeof EMPTY_INDEX> {
  try {
    const [scanRes, postRes] = await Promise.all([
      supabase.from("cmo_runs").select("id").eq("kind", "sales_scan").eq("status", "done").order("finished_at", { ascending: false, nullsFirst: false }).limit(100),
      supabase.from("content_items").select("id, created_at, sources:body->sources").eq("department", "post").order("created_at", { ascending: false }).limit(1000),
    ]);
    if (scanRes.error || postRes.error) return EMPTY_INDEX;
    const scanRows = (scanRes.data ?? []) as { id: string }[];
    const scans = numbersFromNewest(scanRows);
    const peopleRes = scanRows.length
      ? await supabase.from("opportunities").select("id, run_id, score, created_at").in("run_id", scanRows.map((r) => r.id)).limit(2000)
      : { data: [], error: null };
    const people = personNumbers(peopleRes.error ? [] : ((peopleRes.data ?? []) as PersonRow[]), scans);
    const postRows = (postRes.data ?? []) as PostRow[];
    const posts = numbersFromNewest(postRows);
    return { scans, people, posts, usedIn: usedIn(postRows, posts) };
  } catch (error) {
    console.error("[screens] index not read", error);
    return EMPTY_INDEX;
  }
}

async function sales({ supabase, userId }: LoadContext): Promise<Partial<SalesScreen>> {
  const index = indexOf(supabase);
  // SQL `cmo_paid`: a paid plan or credits left. Read once; the threads wait on it so an unpaid account's rows are read
  // without the reply column, and a failed read fails the threads too rather than sending text that was not paid for.
  const paid = (async () => {
    const r = await supabase.from("profiles").select("plan, credit_balance").eq("id", userId).maybeSingle<{ plan: string | null; credit_balance: number | string | null }>();
    if (r.error || !r.data) throw new Error(`profiles: ${r.error?.message ?? "missing"}`);
    return isPaidPlan(r.data.plan) || Number(r.data.credit_balance ?? 0) > 0;
  })();
  return parts<SalesScreen>("sales", {
    free: async () => !(await paid),
    freeScansDone: async () => {
      const r = await supabase.from("cmo_runs").select("id", { count: "exact", head: true }).eq("kind", "sales_scan").eq("status", "done").eq("output->>free", "true");
      if (r.error) throw new Error(`cmo_runs: ${r.error.message}`);
      return r.count ?? 0;
    },
    lastScan: async () => {
      const r = await supabase.from("cmo_runs").select("output, finished_at, created_at").eq("kind", "sales_scan").eq("status", "done").order("created_at", { ascending: false }).limit(1).maybeSingle<{ output: unknown; finished_at: string | null; created_at: string }>();
      if (r.error) throw new Error(`cmo_runs: ${r.error.message}`);
      return r.data ? toLastScan(r.data.output, r.data.finished_at ?? r.data.created_at) : null;
    },
    threads: async () => {
      const free = !(await paid);
      const base = "id, run_id, platform, url, community, title, author, snippet, posted_at, comments, score, score_parts, status, rule, rule_why, min_karma, min_account_age_days, person_status, status_at, reply_url, replied_at, reach_level, reach";
      const { scans, people, usedIn: fed } = await index;
      // The DM and nudge drafts are written work, like the reply: an unpaid account's rows are read without them.
      const columns = free ? base : `${base}, reply, dm_draft, nudge_draft`;
      // Free: whether a reply exists is all the screen needs, and the reply itself stays in the database.
      // The newest threads, and the people already replied to (Following up), who may be older than those.
      const [newest, followed, cards, written] = await Promise.all([
        supabase.from("opportunities").select(columns).order("created_at", { ascending: false }).limit(30),
        supabase.from("opportunities").select(columns).eq("status", "replied").order("decided_at", { ascending: false }).limit(30),
        waitingByRef(supabase, "opportunity"),
        free
          ? supabase.from("opportunities").select("id").neq("reply", "").order("created_at", { ascending: false }).limit(30).then((r) => new Set((must(r, "opportunities") as { id: string }[]).map((x) => x.id)))
          : Promise.resolve(null),
      ]);
      type Part = { label?: string; score?: number; max?: number; evidence?: string };
      const seen = new Set<string>();
      const rows = [...(must(newest, "opportunities") as unknown as { id: string }[]), ...(must(followed, "opportunities") as unknown as { id: string }[])].filter((r) => !seen.has(r.id) && seen.add(r.id));
      return (rows as unknown as { id: string; run_id: string | null; platform: string | null; url: string; community: string; title: string; author: string | null; snippet: string | null; posted_at: string | null; comments: number; score: number; score_parts: Part[] | null; reply?: string | null; status: "in_review" | "replied" | "dismissed"; rule: string | null; rule_why: string | null; min_karma: number | null; min_account_age_days: number | null; person_status: string; status_at: string | null; reply_url: string | null; replied_at: string | null; reach_level: string; reach: unknown; dm_draft?: string | null; nudge_draft?: string | null }[])
        .map((r) => {
          const kind = salesRuleKind(r.rule);
          // A free account never holds reply text (free-scan plan): `reply` was not selected for it.
          const reply = free ? null : r.reply || null;
          const drafted = r.rule === "skip" || (free ? written!.has(r.id) : reply !== null);
          const needs = salesNeeds(r.min_karma, r.min_account_age_days);
          const parts = (r.score_parts ?? []).filter((p) => ["Pain", "Fit", "Timing", "Reach", "Evidence"].includes(p.label ?? "") && typeof p.score === "number" && typeof p.max === "number" && p.max > 0);
          return {
            id: r.id,
            score: Math.max(0, Math.min(100, Math.round(r.score))),
            platform: SALES_PLATFORMS.find((p) => p === r.platform) ?? "reddit",
            community: (r.community || "Reddit").slice(0, 80),
            postedAt: iso(r.posted_at),
            comments: r.comments,
            title: r.title.slice(0, 300),
            // What the person wrote, so the founder reads it before replying (owner, 2026-11-23). Empty for a Reddit card
            // saved from a trimmed search before posts were read.
            body: (r.snippet ?? "").slice(0, 1500),
            author: (r.author ?? "").slice(0, 100),
            url: r.url,
            ...(people.has(r.id) ? { no: people.get(r.id)! } : {}),
            ...(r.run_id && scans.has(r.run_id) ? { scanNo: scans.get(r.run_id)! } : {}),
            ...(fed.has(r.id) ? { usedIn: fed.get(r.id)!.slice(0, 10) } : {}),
            // P5 R1: the rule the draft was written under. Threads from before it are help first, no product mention.
            rule: {
              kind,
              text: (r.rule_why ?? (r.rule ? "" : "Rules not checked: help first")).slice(0, 200) || (kind === "skipped" ? "Skipped by the community's rules" : "Help only"),
              ...(needs ? { needs } : {}),
            },
            parts: parts.map((p) => ({ label: p.label as "Pain", score: p.score!, max: p.max! })),
            quotes: parts.filter((p) => typeof p.evidence === "string" && p.evidence).map((p) => ({ text: p.evidence!.slice(0, 400), from: p.label!.toLowerCase() })),
            draft: r.rule === "skip" ? null : reply,
            drafted,
            draftChecks:
              kind === "skipped" || !reply
                ? null
                : `No links · under 120 words · ${kind === "mention_allowed" || kind === "requires_disclosure" ? "product named at most once, saying it is yours" : "no product mention"}`,
            status: r.status === "in_review" ? ("open" as const) : r.status,
            approvalId: cards.get(r.id) ?? null,
            person: {
              status: PERSON_STATUSES.find((p) => p === r.person_status) ?? ("found" as const),
              statusAt: iso(r.status_at),
              replyUrl: r.reply_url && /^https?:\/\//.test(r.reply_url) ? r.reply_url : null,
              repliedAt: iso(r.replied_at),
              reachLevel: REACH_LEVELS.find((l) => l === r.reach_level) ?? ("reply_first" as const),
              // Written by `cmo_save_reach`; a check that does not parse shows as no check rather than a broken one.
              reach: ReachCheckSchema.safeParse(r.reach).data ?? null,
              dmDraft: free ? null : (r.dm_draft || null),
              nudgeDraft: free ? null : (r.nudge_draft || null),
            },
          };
        })
        .sort((a, b) => Number(b.status === "open") - Number(a.status === "open"));
    },
    scans: async () => {
      const [{ scans }, r] = await Promise.all([
        index,
        supabase.from("cmo_runs").select("id, output, finished_at, created_at").eq("kind", "sales_scan").eq("status", "done").order("finished_at", { ascending: false, nullsFirst: false }).limit(50),
      ]);
      if (r.error) throw new Error(`cmo_runs: ${r.error.message}`);
      return ((r.data ?? []) as { id: string; output: unknown; finished_at: string | null; created_at: string }[]).flatMap((row) => {
        const no = scans.get(row.id);
        const o = toLastScan(row.output, row.finished_at ?? row.created_at);
        return no ? [{ no, at: new Date(row.finished_at ?? row.created_at).toISOString(), cards: o?.cards ?? 0, verdict: o?.verdict ?? ("none" as const) }] : [];
      });
    },
    week: async () => {
      const monday = `${mondayOf()}T00:00:00Z`;
      const count = async (status: string) => {
        const r = await supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("status", status).gte("decided_at", monday);
        if (r.error) throw new Error(`opportunities: ${r.error.message}`);
        return r.count ?? 0;
      };
      const [replied, dismissed] = await Promise.all([count("replied"), count("dismissed")]);
      return { replied, dismissed };
    },
    // P5 F3: product mentions in the last ten posted replies (at most one in ten).
    mentions: async () => {
      const r = await supabase.rpc("sales_mention_count");
      if (r.error) throw new Error(`sales_mention_count: ${r.error.message}`);
      return { used: Number(r.data ?? 0), window: 10 };
    },
    // P5 F6: the last two scans found nothing worth joining; the banner offers a scan with a new brief.
    stuck: async () => {
      const r = await supabase.from("cmo_runs").select("status, output").eq("kind", "sales_scan").in("status", ["done", "failed"]).order("created_at", { ascending: false }).limit(2);
      if (r.error) throw new Error(`cmo_runs: ${r.error.message}`);
      const runs = (r.data ?? []) as { status: string; output: { cards?: number } | null }[];
      if (runs.length < 2 || runs.some((x) => x.status !== "done" || (x.output?.cards ?? 0) > 0)) return null;
      return { text: "Your last two scans found no conversation worth joining. Try a different brief, or fewer excluded subreddits.", creditsToFinish: 5, found: 0 };
    },
    settings: async () => {
      const r = await supabase.from("sales_settings").select("excluded_subreddits, co_occurrence, platforms").maybeSingle();
      if (r.error) throw new Error(`sales_settings: ${r.error.message}`);
      const row = r.data as { excluded_subreddits: string[]; co_occurrence: [string, string][]; platforms: string[] | null } | null;
      // No row yet: every place is on (the column's default).
      const platforms = SALES_PLATFORMS.filter((p) => (row?.platforms ?? SALES_PLATFORMS).includes(p));
      return {
        excludedSubreddits: (row?.excluded_subreddits ?? []).slice(0, 50),
        pairs: (row?.co_occurrence ?? []).slice(0, 20),
        platforms: platforms.length ? platforms : [...SALES_PLATFORMS],
      };
    },
  });
}

/**
 * What Analytics and the Dashboard's results read (P6 A1): accounts, their days and the newest reading of each post
 * published in twice the range (the second half is the comparison), all under the founder's RLS session. Published
 * posts come from `my_published_items`: a video's caption item counts once a slot published its clip, though the
 * caption itself stays `approved` (the slot publishes the clip, not the caption).
 */
/** A stored count as a number, or null when it was not reported (bigint columns can arrive as strings). */
const orNull = (v: number | string | null): number | null => (v === null ? null : Number(v));

async function measured(
  supabase: SupabaseClient,
  range: number,
  now: Date,
): Promise<{ accounts: AccountIn[]; days: AccountDayIn[]; posts: PostIn[]; published: number; publishedAt: string[] }> {
  // One day more than twice the range: the founder's today can be a day ahead of UTC's.
  const since = new Date(now.getTime() - (2 * range + 1) * 86_400_000);
  const sinceDay = since.toISOString().slice(0, 10);
  const [accounts, days, items] = await Promise.all([
    socialAccounts(supabase),
    supabase
      .from("account_metrics")
      .select("social_account_id, platform, handle, day, followers, impressions, engagements, video_views, measured_at")
      .gte("day", sinceDay)
      .order("day")
      .limit(5000),
    supabase.rpc("my_published_items", { p_since: since.toISOString() }),
  ]);
  const itemRows = (must(items, "my_published_items") as { item_id: string; platform: string; idea: string; final_text: string | null; published_at: string }[]).map(
    ({ item_id, ...rest }) => ({ id: item_id, ...rest }),
  );
  const metricRows = itemRows.length
    ? (must(
        await supabase
          .from("post_metrics")
          .select("item_id, url, views, likes, replies, reposts, impressions, engagements, measured_at")
          .in("item_id", itemRows.map((i) => i.id))
          .order("measured_at", { ascending: false })
          .limit(5000),
        "post_metrics",
      ) as { item_id: string; url: string; views: number | null; likes: number | null; replies: number | null; reposts: number | null; impressions: number | null; engagements: number | null }[])
    : [];
  const newest = new Map<string, (typeof metricRows)[number]>();
  for (const m of metricRows) if (!newest.has(m.item_id)) newest.set(m.item_id, m);
  const posts: PostIn[] = itemRows.flatMap((i) => {
    const m = newest.get(i.id);
    // "tiktok_caption" → tiktok: a caption item is measured on its platform.
    const platform = screenPlatform(i.platform, "x");
    return m
      ? [{
          id: i.id,
          title: (i.final_text ?? i.idea).split("\n")[0]!.slice(0, 200),
          platform,
          publishedAt: new Date(i.published_at).toISOString(),
          views: orNull(m.views),
          impressions: orNull(m.impressions),
          engagements: orNull(m.engagements),
          likes: orNull(m.likes),
          replies: orNull(m.replies),
          reposts: orNull(m.reposts),
          url: m.url || null,
        }]
      : [];
  });
  const fromRange = new Date(now.getTime() - range * 86_400_000).toISOString();
  return {
    accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, handle: a.handle, avatarUrl: a.avatar_url, status: a.status, updatedAt: a.updated_at })),
    days: (must(days, "account_metrics") as AccountDayIn[]).map((d) => ({
      ...d,
      followers: d.followers === null ? null : Number(d.followers),
      impressions: d.impressions === null ? null : Number(d.impressions),
      engagements: d.engagements === null ? null : Number(d.engagements),
      video_views: d.video_views === null ? null : Number(d.video_views),
    })),
    posts,
    published: itemRows.filter((i) => i.published_at >= fromRange).length,
    publishedAt: itemRows.map((i) => new Date(i.published_at).toISOString()),
  };
}

async function analytics({ supabase, userId, params }: LoadContext): Promise<Partial<AnalyticsScreen>> {
  const parsed = RangeSchema.safeParse(Number(params.get("range") ?? 30));
  const range = parsed.success ? parsed.data : 30;
  const now = new Date();
  // The two reads do not need each other: one round trip, not two.
  // `brainReads` is live and empty: no model reads these numbers yet, and a sample line would read as a real finding.
  const [m, timezone] = await Promise.all([
    measured(supabase, range, now),
    profile(supabase, userId).then((p) => p.timezone, () => "UTC"),
  ]);
  return buildAnalytics({ range, now, accounts: m.accounts, days: m.days, posts: m.posts, publishedInRange: m.published, published: m.publishedAt, timezone });
}

/**
 * The rail's two status lines (P6 F14): the next slot waiting to go out (schedule cards wait on the founder, so only
 * approved slots count) and how many accounts Analytics reads. Null fields draw no line.
 */
export async function loadRailStatus({ supabase, userId }: Omit<LoadContext, "params">): Promise<RailStatus> {
  const [p, next, accounts] = await Promise.all([
    profile(supabase, userId),
    supabase.from("schedule_slots").select("publish_at").eq("status", "waiting").gt("publish_at", new Date().toISOString()).order("publish_at").limit(1).maybeSingle(),
    supabase.from("social_accounts").select("id", { count: "exact", head: true }).eq("status", "connected"),
  ]);
  const at = (next.data as { publish_at?: string } | null)?.publish_at ?? null;
  return { nextPostAt: at ? new Date(at).toISOString() : null, connectedAccounts: accounts.count ? accounts.count : null, timezone: p.timezone };
}

/**
 * Live readers, one per screen, under the founder's RLS session (no service role). A loader returns only the
 * fields it reads for real; `registry.ts` `live` must list them too before they replace sample data.
 */
export const LOADERS: { [N in ScreenName]?: Loader<N> } = { dashboard, analytics, brain, library, settings, schedule, research, writer, studio: studioScreen, sales };
