import "server-only";

import type { SupabaseClient } from "@/lib/api/handler";
import { brainMode } from "@/lib/cmo/brain";
import { loadDigestInput, localClock } from "@/lib/cmo/digest";
import { DOCUMENTS, DOCUMENT_KINDS, type DocumentKind } from "@/lib/cmo/documents";
import { classifyOrder, nextCheckAt, type OrderLedgerRow } from "@/lib/cmo/jobs/progress";
import { SITE_URL } from "@/lib/site";

import type { ApprovalCard } from "./approval-card";
import type { BrainScreen, OrderRow, OrderState } from "./brain";
import { APPROVAL_COLUMNS, approvalToCard, type ApprovalRow } from "./cards";
import { DEPARTMENTS, TEAM, type CmoState, type Department } from "./common";
import type { DashboardScreen } from "./dashboard";
import type { LibraryScreen } from "./library";
import type { ScreenData, ScreenName } from "./registry";
import type { SettingsScreen } from "./settings";

export type LoadContext = { supabase: SupabaseClient; userId: string; params: URLSearchParams };

type Loader<N extends ScreenName> = (ctx: LoadContext) => Promise<Partial<ScreenData<N>>>;

/** `cmo_job_price` (SQL): an order that needs credits and has none is over budget. */
const PRICES: Record<string, number> = { plan_week: 1, post_draft: 1, sales_scan: 5, competitor_research: 2 };

const iso = (v: string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

/** Monday of the current UTC week, as `date_trunc('week', current_date)` in SQL. */
function mondayUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
}

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

/** The queue: waiting cards, oldest first. Kinds the app cannot show yet (A1, A3) are left out. */
async function waitingCards(supabase: SupabaseClient): Promise<ApprovalCard[]> {
  const rows = must(
    await supabase.from("approvals").select(APPROVAL_COLUMNS).eq("status", "waiting").order("created_at", { ascending: true }).limit(100),
    "approvals",
  ) as ApprovalRow[];
  return rows.map((row) => approvalToCard(row)).filter((c): c is ApprovalCard => c !== null);
}

type OrderDb = OrderLedgerRow & { user_id: string; root_id: string | null; week: string; created_at: string; done_reason: string | null };
const ORDER_COLUMNS = "id, user_id, root_id, parent_id, week, kind, title, department, status, due_at, budget_credits, spent_credits, updated_at, created_at, brief, error, done_reason";

/** This week's tree: the root and its orders, parents before children. */
async function weekTree(supabase: SupabaseClient, week = mondayUtc()): Promise<{ root: OrderDb | null; orders: OrderDb[] }> {
  const rows = must(await supabase.from("work_orders").select(ORDER_COLUMNS).eq("week", week).order("created_at").limit(500), "work_orders") as OrderDb[];
  const root = rows.find((o) => o.parent_id === null) ?? null;
  const children = rows.filter((o) => o.parent_id !== null);
  const sorted: OrderDb[] = [];
  const visit = (parent: string) => {
    for (const o of children.filter((c) => c.parent_id === parent)) {
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
  if (o.status === "queued" && classifyOrder(o, now, PRICES[o.kind] ?? 0) === "over_budget") return "Stuck: budget";
  return STATE_TEXT[o.status];
}

/** The waiting card of each order (through its deliverables), for the "Open" link on a row. */
async function cardsByOrder(supabase: SupabaseClient, orderIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!orderIds.length) return out;
  const deliverables = must(await supabase.from("deliverables").select("order_id, ref_kind, ref_id").in("order_id", orderIds), "deliverables") as {
    order_id: string;
    ref_kind: string;
    ref_id: string;
  }[];
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

async function weekGoal(supabase: SupabaseClient, week = mondayUtc()): Promise<string | null> {
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
      const verdict = (o: OrderDb) => classifyOrder(o, now, PRICES[o.kind] ?? 0);
      const nodes = TEAM.map((department) => {
        const mine = orders.filter((o) => o.department === department);
        const running = mine.find((o) => o.status === "running");
        const stuck = mine.find((o) => verdict(o) === "stuck" || verdict(o) === "over_budget");
        const next = mine.filter((o) => o.status === "queued").sort((a, b) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9"))[0];
        const state: "working" | "idle" | "stuck" = stuck ? "stuck" : running ? "working" : "idle";
        const line = stuck
          ? `Stuck: ${stuck.title}`
          : running
            ? `Working on “${running.title}”`
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
      return orderRows(visible, await cardsByOrder(supabase, visible.map((o) => o.id)), root.id, now);
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
      const thisWeek = mondayUtc(now);
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

/**
 * Live readers, one per screen, under the founder's RLS session (no service role). A loader returns only the
 * fields it reads for real; `registry.ts` `live` must list them too before they replace sample data.
 */
export const LOADERS: { [N in ScreenName]?: Loader<N> } = { dashboard, brain, library, settings };
