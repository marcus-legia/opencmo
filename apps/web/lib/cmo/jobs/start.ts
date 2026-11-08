import "server-only";

/**
 * Queues a CMO job (as the founder: the daily cap and the credit hold live in `enqueue_cmo_run`) and runs it RIGHT
 * after the response, with the service role: the same path as the cron, so a job only ever runs one way.
 */

import { after } from "next/server";

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";
import { createAdminClient } from "@/lib/supabase/admin";

import { PAUSED_EVERYWHERE, cmoPausedEverywhere } from "../pause";
import { socialReaderReady } from "../social/reddit";

import { drainCmoQueue } from "./runner";
import { supabaseStore } from "./store";
import type { CmoJobKind } from "./types";

export type StartedRun = { id: string; kind: CmoJobKind; status: "queued" | "running" | "done" | "failed"; created_at: string };

/**
 * Runs `runId` (or drains the queue) after the response is sent. Errors are only logged: the run
 * stays queued and Modal's `sweep()` dispatches it again within a minute.
 */
export function kickCmoQueue(runId?: string, budgetMs = 250_000): void {
  after(async () => {
    try {
      await drainCmoQueue(supabaseStore(createAdminClient()), { runId, budgetMs });
    } catch (error) {
      console.error("[cmo] draining the queue failed", error);
    }
  });
}

/** What one CMO job may take in `after()`: a run started later than this before the deadline is left to the sweep. */
const JOB_MS = 120_000;

/**
 * The first week after onboarding (cmo-review-2 S2.2): runs the plan after the response, then queues today's draft only
 * once the plan is written, so the draft reads the plan's first post and Modal's sweep cannot claim it early. A job
 * starts here only when it can finish before `deadline` (the function's time limit, C5); otherwise it waits for the
 * sweep, within a minute.
 */
export function kickFirstWeek(userId: string, planId: string, input: Record<string, unknown>, deadline: number): void {
  after(async () => {
    const admin = createAdminClient();
    const store = supabaseStore(admin);
    try {
      if (Date.now() + JOB_MS < deadline) await drainCmoQueue(store, { runId: planId, budgetMs: JOB_MS });
      const { data: plan } = await admin.from("cmo_runs").select("status").eq("id", planId).maybeSingle<{ status: string }>();
      // Not written yet (left to the sweep, or failed): today's draft comes with the daily loop instead.
      if (plan?.status !== "done") return;
      const { data, error } = await admin.rpc("enqueue_cmo_run_for", { p_user: userId, p_kind: "post_draft", p_input: input });
      if (error) return console.error("[cmo] first week: could not queue the first draft", error.message);
      const draft = (Array.isArray(data) ? data[0] : data) as { id?: string; status?: string } | null;
      if (draft?.id && draft.status === "queued" && Date.now() + JOB_MS < deadline) await drainCmoQueue(store, { runId: draft.id, budgetMs: JOB_MS });
    } catch (error) {
      console.error("[cmo] first week: draining failed", error);
    }
  });
}

/**
 * `kick: false` leaves the run to Modal's sweep (within a minute): a request already late in its function's time limit
 * would cut the `after()` drain short mid-job (review follow-up C5).
 */
export async function startCmoRun(supabase: SupabaseClient, kind: CmoJobKind, input: Record<string, unknown> = {}, opts: { kick?: boolean } = {}): Promise<StartedRun> {
  if (cmoPausedEverywhere()) throw new ApiError(503, PAUSED_EVERYWHERE);
  // Checked BEFORE credits are held: without a Reddit reader key every run would fail.
  if (kind === "sales_scan" && !socialReaderReady()) throw new ApiError(503, "Reddit scanning is not set up on this server yet.");
  if ((kind === "competitor_research" || kind === "niche_video_research" || kind === "pull_metrics") && !socialReaderReady()) throw new ApiError(503, "Social research is not set up on this server yet.");
  const run = firstRow(await rpcOrThrow<StartedRun | StartedRun[]>(supabase, "enqueue_cmo_run", { p_kind: kind, p_input: input }));
  if (!run) throw new ApiError(500, "Could not start this task.");
  // An inbox run only goes as far as its first model call: Modal's sweep opens it within a
  // minute, and over MCP there is no Next.js `after()` to run it here.
  if (run.status === "queued" && input.brain !== "claude" && opts.kick !== false) kickCmoQueue(run.id);
  return run;
}
