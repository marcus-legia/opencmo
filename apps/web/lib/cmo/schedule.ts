import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { brainModes } from "@/lib/cmo/brain";
import { isoDay, type CmoJobKind } from "@/lib/cmo/jobs/types";
import { dueLoops, type LoopState } from "@/lib/cmo/loops";
import { socialReaderReady } from "@/lib/cmo/social/reddit";

/**
 * Reads every user's state and enqueues the loops due today (`lib/cmo/loops.ts`). Only enqueues:
 * the runs are dispatched to `/api/internal/cmo/run` by Modal's `sweep()`, in parallel.
 *
 * Called once a day. The loops are daily and `enqueue_cmo_run_for` only dedupes runs that are
 * still queued or running, so calling this more often would re-run a loop whose run already
 * finished (the Monday plan, for one).
 */
/** Loops that call a model: for a founder in mode B they go to the inbox instead. */
const THINKING: ReadonlySet<CmoJobKind> = new Set(["plan_week", "post_draft", "sales_scan", "competitor_research", "summarize_memory", "review_week"]);

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

export async function enqueueDueLoops(admin: SupabaseClient): Promise<{ users: number; queued: number; inbox: number }> {
  const today = isoDay();
  const weekday = new Date().getUTCDay();

  const { data: docs, error } = await admin.from("marketing_documents_latest").select("user_id, kind, body").in("kind", ["product", "competitors"]);
  if (error) throw new Error(`users: ${error.message}`);
  const rows = (docs ?? []) as { user_id: string; kind: string; body: Record<string, unknown> }[];
  const users = [...new Set(rows.filter((r) => r.kind === "product").map((r) => r.user_id))];
  const handles = new Map<string, number>();
  for (const row of rows.filter((r) => r.kind === "competitors")) {
    const list = Array.isArray(row.body.competitors) ? (row.body.competitors as { x_handle?: unknown }[]) : [];
    handles.set(row.user_id, list.filter((c) => typeof c.x_handle === "string" && c.x_handle.trim()).length);
  }

  const { data: due } = await admin
    .from("content_items")
    .select("id, user_id, department, idea, day")
    .in("department", ["post", "sales"])
    .eq("status", "planned")
    .lte("day", today)
    .order("day");
  const dueRows = (due ?? []) as { id: string; user_id: string; department: string; idea: string }[];
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: published } = await admin.from("content_items").select("user_id").eq("status", "published").eq("department", "post").gte("published_at", since);
  const publishedBy = new Map<string, number>();
  for (const p of (published ?? []) as { user_id: string }[]) publishedBy.set(p.user_id, (publishedBy.get(p.user_id) ?? 0) + 1);
  const socialReader = socialReaderReady();
  const modes = await brainModes(admin, users);

  let queued = 0;
  let inbox = 0;
  for (const user of users) {
    const firstDue = (department: string) => {
      const row = dueRows.find((d) => d.user_id === user && d.department === department);
      return row ? { idea: row.idea, id: row.id } : null;
    };
    const state: LoopState = {
      weekday,
      duePost: firstDue("post"),
      dueSales: firstDue("sales"),
      competitorHandles: handles.get(user) ?? 0,
      publishedRecently: publishedBy.get(user) ?? 0,
      socialReader,
    };
    // Mode B: the run reads what it needs, then waits in the founder's inbox for their Claude.
    const claude = modes.get(user)?.brain === "claude";
    const links = await dueLinks(admin, [state.duePost?.id, state.dueSales?.id]);
    for (const run of dueLoops(state)) {
      const toInbox = claude && THINKING.has(run.kind);
      const item = run.kind === "post_draft" ? state.duePost?.id : run.kind === "sales_scan" ? state.dueSales?.id : undefined;
      const input = {
        ...run.input,
        loop: run.loop,
        ...(item ? { item_id: item, ...(links.get(item) ? { order_id: links.get(item) } : {}) } : {}),
        ...(toInbox ? { brain: "claude" } : {}),
      };
      const { error: enqueueError } = await admin.rpc("enqueue_cmo_run_for", { p_user: user, p_kind: run.kind, p_input: input });
      // Out of credits or at the daily cap: skip this user, keep going for the others.
      if (enqueueError) console.warn("[cron] cmo: skipped", run.loop, enqueueError.message);
      else {
        queued += 1;
        if (toInbox) inbox += 1;
      }
    }
  }
  return { users: users.length, queued, inbox };
}
