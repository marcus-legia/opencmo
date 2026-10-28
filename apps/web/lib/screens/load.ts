import "server-only";

import type { SupabaseClient } from "@/lib/api/handler";
import { brainMode } from "@/lib/cmo/brain";
import { loadDigestInput, localClock } from "@/lib/cmo/digest";
import { DOCUMENTS, DOCUMENT_KINDS, type DocumentKind } from "@/lib/cmo/documents";
import { JOB_PRICES, classifyOrder, nextCheckAt, type OrderLedgerRow } from "@/lib/cmo/jobs/progress";
import { mondayOf } from "@/lib/cmo/jobs/summarize-memory";
import { SITE_URL } from "@/lib/site";

import type { ApprovalCard } from "./approval-card";
import type { BrainScreen, OrderRow, OrderState } from "./brain";
import { APPROVAL_COLUMNS, approvalToCard, type ApprovalRow } from "./cards";
import { signStudioCards } from "./studio-sign";
import { DEPARTMENTS, TEAM, type CmoState, type Department } from "./common";
import type { DashboardScreen } from "./dashboard";
import type { LibraryScreen } from "./library";
import type { ResearchScreen } from "./research";
import type { SalesScreen } from "./sales";
import type { ScreenData, ScreenName } from "./registry";
import type { SettingsScreen } from "./settings";
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

async function profile(supabase: SupabaseClient, userId: string): Promise<Profile> {
  const r = await supabase.from("profiles").select("weekly_credit_budget, timezone, digest_hour, cmo_paused_at, plan").eq("id", userId).maybeSingle();
  if (r.error || !r.data) throw new Error(`profiles: ${r.error?.message ?? "missing"}`);
  return r.data as Profile;
}

async function cmoState(supabase: SupabaseClient, userId: string, p: Promise<Profile>): Promise<CmoState> {
  const [mode, prof] = await Promise.all([brainMode(supabase, userId), p]);
  return { mode: mode.brain, pausedAt: iso(prof.cmo_paused_at) };
}

/** The queue: waiting cards, oldest first, Studio pictures signed. Kinds the app cannot show yet are left out. */
async function waitingCards(supabase: SupabaseClient): Promise<ApprovalCard[]> {
  const rows = must(
    await supabase.from("approvals").select(APPROVAL_COLUMNS).eq("status", "waiting").order("created_at", { ascending: true }).limit(100),
    "approvals",
  ) as ApprovalRow[];
  return signStudioCards(supabase, rows.map((row) => approvalToCard(row)).filter((c): c is ApprovalCard => c !== null), rows);
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
  return (r.data as { goal: string } | null)?.goal ?? null;
}

const OPEN: ReadonlySet<string> = new Set(["queued", "running", "waiting_founder", "waiting_order", "deferred"]);

async function dashboard({ supabase, userId }: LoadContext): Promise<Partial<DashboardScreen>> {
  const now = new Date();
  const prof = profile(supabase, userId);
  const tree = weekTree(supabase);
  const queue = waitingCards(supabase);
  return parts<DashboardScreen>("dashboard", {
    cmo: () => cmoState(supabase, userId, prof),
    queue: () => queue,
    week: async () => {
      const [{ root, orders }, goal, p] = await Promise.all([tree, weekGoal(supabase), prof]);
      const open = orders.filter((o) => o.status !== "cancelled");
      const today = now.toISOString().slice(0, 10);
      const drafts = must(
        await supabase.from("content_items").select("body").eq("department", "post").gte("updated_at", `${today}T00:00:00Z`).in("status", ["in_review", "approved", "published"]),
        "content_items",
      ) as { body: { text?: string } }[];
      const words = drafts.reduce((n, d) => n + (typeof d.body.text === "string" ? d.body.text.split(/\s+/).filter(Boolean).length : 0), 0);
      return {
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
    outToday: async () => {
      const today = now.toISOString().slice(0, 10);
      const rows = must(
        await supabase
          .from("content_items")
          .select("id, platform, idea, final_text, status, day, published_at, decided_at")
          .eq("department", "post")
          .in("status", ["approved", "published"])
          .or(`day.eq.${today},published_at.gte.${today}T00:00:00Z`)
          .limit(20),
        "content_items",
      ) as { id: string; platform: string; idea: string; final_text: string | null; status: string; published_at: string | null; decided_at: string | null }[];
      return rows
        .map((r) => ({
          id: r.id,
          at: new Date(r.published_at ?? r.decided_at ?? now).toISOString(),
          where: { platform: "x" as const, handle: "your account" },
          text: (r.final_text ?? r.idea).slice(0, 300),
          // Assisted posting (W3): an approved X post waits for the founder to post it on X.
          status: r.status === "published" ? ("posted" as const) : ("scheduled" as const),
          problem: null,
          approvalId: null,
        }))
        .sort((a, b) => a.at.localeCompare(b.at));
    },
    digest: async () => {
      const p = await prof;
      const clock = localClock(now, p.timezone);
      const input = await loadDigestInput(supabase, userId, { appUrl: SITE_URL, dateLabel: clock.dateLabel, now });
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

async function brain({ supabase, userId }: LoadContext): Promise<Partial<BrainScreen>> {
  const now = new Date();
  const prof = profile(supabase, userId);
  const tree = weekTree(supabase);
  return parts<BrainScreen>("brain", {
    cmo: () => cmoState(supabase, userId, prof),
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
          goal: g?.goal ?? null,
          result,
          done: mine.filter((k) => k.status === "done").length,
          total: mine.length,
          credits: { used: r.spent_credits, budget: r.budget_credits },
        };
      });
    },
  });
}

async function library({ supabase }: LoadContext): Promise<Partial<LibraryScreen>> {
  return parts<LibraryScreen>("library", {
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
    cmo: () => cmoState(supabase, userId, prof),
    weeklyCreditBudget: async () => (await prof).weekly_credit_budget,
    timezone: async () => (await prof).timezone,
    digestHour: async () => (await prof).digest_hour,
    plan: async () => {
      const [p, balance] = await Promise.all([prof, supabase.rpc("credit_balance", { p_user_id: userId })]);
      const name = p.plan.charAt(0).toUpperCase() + p.plan.slice(1);
      return { name: name.slice(0, 40), credits: typeof balance.data === "number" ? balance.data : null };
    },
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

async function research({ supabase }: LoadContext): Promise<Partial<ResearchScreen>> {
  const now = new Date();
  const latest = supabase.from("cmo_insights").select("body, created_at").eq("kind", "competitors").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return parts<ResearchScreen>("research", {
    lastRunAt: async () => {
      const r = await supabase.from("cmo_runs").select("finished_at").eq("kind", "competitor_research").eq("status", "done").order("finished_at", { ascending: false }).limit(1).maybeSingle();
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
      const r = await latest;
      if (r.error) throw new Error(`cmo_insights: ${r.error.message}`);
      const body = ((r.data as { body?: { hooks?: unknown[] } } | null)?.body ?? {}) as { hooks?: { pattern?: string; example?: string; url?: string; lift?: number }[] };
      // Every insight points to the post it came from: one without a link is dropped (counted in `dropped`).
      return (body.hooks ?? [])
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
    },
    dropped: async () => {
      const r = await latest;
      if (r.error) throw new Error(`cmo_insights: ${r.error.message}`);
      const body = ((r.data as { body?: unknown } | null)?.body ?? {}) as { hooks?: { url?: unknown }[]; formats?: unknown[]; ideas?: unknown[] };
      return (body.hooks ?? []).filter((h) => !isHttps(h.url)).length + (body.formats ?? []).length + (body.ideas ?? []).length;
    },
    results: async () => {
      const metrics = must(await supabase.from("post_metrics").select("item_id, views, replies, measured_at").order("measured_at", { ascending: false }).limit(100), "post_metrics") as {
        item_id: string;
        views: number;
        replies: number;
      }[];
      const latestPerItem = [...new Map(metrics.map((m) => [m.item_id, m])).values()].slice(0, 10);
      if (!latestPerItem.length) return [];
      const items = must(await supabase.from("content_items").select("id, idea, final_text").in("id", latestPerItem.map((m) => m.item_id)), "content_items") as {
        id: string;
        idea: string;
        final_text: string | null;
      }[];
      return latestPerItem.map((m) => {
        const item = items.find((i) => i.id === m.item_id);
        return { id: m.item_id, title: (item?.final_text ?? item?.idea ?? "X post").slice(0, 200), platform: "x" as const, views: Number(m.views), replies: Number(m.replies) };
      });
    },
  });
}

async function writer({ supabase }: LoadContext): Promise<Partial<WriterScreen>> {
  return parts<WriterScreen>("writer", {
    drafts: async () => {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      const [rows, cards] = await Promise.all([
        supabase
          .from("content_items")
          .select("id, day, idea, status, body, final_text, published_at")
          .eq("department", "post")
          .in("status", ["planned", "drafting", "in_review", "approved", "published"])
          .gte("day", since)
          .order("day")
          .limit(100),
        waitingByRef(supabase, "content_item"),
      ]);
      const column = { planned: "drafting", drafting: "drafting", in_review: "waiting", approved: "scheduled", published: "posted" } as const;
      return (must(rows, "content_items") as { id: string; day: string; idea: string; status: keyof typeof column; body: { text?: string; alternates?: unknown[] }; final_text: string | null; published_at: string | null }[]).map(
        (r) => {
          const text = typeof r.body.text === "string" && r.body.text ? r.body.text : r.idea;
          const edited = r.final_text !== null && r.final_text !== r.body.text;
          return {
            id: r.id,
            kind: "post" as const,
            platform: "x" as const,
            at: iso(r.published_at),
            dayText: r.published_at ? null : WEEKDAY[new Date(`${r.day}T00:00:00Z`).getUTCDay()]!,
            title: (r.final_text ?? text).slice(0, 300),
            column: column[r.status],
            versions: Math.min(3, Math.max(1, 1 + (Array.isArray(r.body.alternates) ? r.body.alternates.length : 0))),
            note: r.status === "published" || r.status === "approved" ? (edited ? "You edited it before approving" : "Approved as drafted") : null,
            approvalId: cards.get(r.id) ?? null,
          };
        },
      );
    },
  });
}

/**
 * Studio (P2 A5): the long videos the brain's orders make and the shorts batches, with their cards; the Video team
 * panel for the video in progress; and every recent edit's finished state (`editStates`), which the page puts on the
 * upload cards it reads from `/api/v1/projects`. Uploads themselves stay on that route.
 */
async function studio({ supabase }: LoadContext): Promise<Partial<StudioScreen>> {
  type VideoOrder = { id: string; title: string; status: OrderDb["status"]; created_at: string; updated_at: string; error: { message?: string } | null; brief: { seconds?: number } };
  type Edit = { clip_id: string; document_hash: string; finished_at: string | null; finished_hash: string | null; updated_at: string; clips: { kind: "full" | "blank" | "short"; hook: string | null } | null };
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
    .select("clip_id, document_hash, finished_at, finished_hash, updated_at, clips(kind, hook)")
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
          canMarkFinished: !!edit && !finished && o.status !== "failed",
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
      return [...videoItems, ...batchItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

async function sales({ supabase }: LoadContext): Promise<Partial<SalesScreen>> {
  return parts<SalesScreen>("sales", {
    threads: async () => {
      const [rows, cards] = await Promise.all([
        supabase.from("opportunities").select("id, url, community, title, posted_at, comments, score, score_parts, reply, status").order("created_at", { ascending: false }).limit(30),
        waitingByRef(supabase, "opportunity"),
      ]);
      type Part = { label?: string; score?: number; max?: number; evidence?: string };
      return (must(rows, "opportunities") as { id: string; url: string; community: string; title: string; posted_at: string | null; comments: number; score: number; score_parts: Part[] | null; reply: string; status: "in_review" | "replied" | "dismissed" }[])
        .map((r) => {
          const parts = (r.score_parts ?? []).filter((p) => ["Pain", "Fit", "Timing", "Reach", "Evidence"].includes(p.label ?? "") && typeof p.score === "number" && typeof p.max === "number" && p.max > 0);
          return {
            id: r.id,
            score: Math.max(0, Math.min(100, Math.round(r.score))),
            community: (r.community || "Reddit").slice(0, 80),
            postedAt: iso(r.posted_at),
            comments: r.comments,
            title: r.title.slice(0, 300),
            url: r.url,
            // Subreddit rules are read with Sales safety (R1); until then every thread is help first, no product mention.
            rule: { kind: "help_only" as const, text: "Rules not checked yet: help first" },
            parts: parts.map((p) => ({ label: p.label as "Pain", score: p.score!, max: p.max! })),
            quotes: parts.filter((p) => typeof p.evidence === "string" && p.evidence).map((p) => ({ text: p.evidence!.slice(0, 400), from: p.label!.toLowerCase() })),
            draft: r.reply,
            draftChecks: null,
            status: r.status === "in_review" ? ("open" as const) : r.status,
            approvalId: cards.get(r.id) ?? null,
          };
        })
        .sort((a, b) => Number(b.status === "open") - Number(a.status === "open"));
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
  });
}

/**
 * Live readers, one per screen, under the founder's RLS session (no service role). A loader returns only the
 * fields it reads for real; `registry.ts` `live` must list them too before they replace sample data.
 */
export const LOADERS: { [N in ScreenName]?: Loader<N> } = { dashboard, brain, library, settings, research, writer, studio, sales };
