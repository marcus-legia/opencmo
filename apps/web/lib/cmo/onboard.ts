import "server-only";

/**
 * W0 Onboarding (docs/cmo/san-pham.md §4.3): website → four documents → the first week, at once.
 *
 * Every write goes through an RPC as the user (web rule #1): `start_cmo_run` blocks overlapping runs and caps them at 5 a
 * day BEFORE any LLM spend; the agent writes each document with `save_marketing_document` and the run id; the run is
 * always finished, even on an error.
 *
 * The first week (cmo-review-2 S2.2): the founder should see the plan and a first draft within minutes, not with the
 * Monday plan. Planning (1 credit) and today's draft (1 credit) are ordinary CMO runs, so they charge, cap and show
 * exactly as any other run; the draft is queued once the plan is written.
 */

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";

import { brainMode } from "./brain";
import { DOCUMENT_KINDS } from "./documents";
import { draftDocuments, GenerateError } from "./generate";
import { kickFirstWeek, startCmoRun, type StartedRun } from "./jobs/start";
import { readSite, SiteError } from "./site";

type RunRow = { id: string };

export type Onboarded = { runId: string; firstWeek: boolean };

/** `started`: when the route began, before its paid check waited, so the first week's deadline counts that wait. */
export async function runOnboarding(supabase: SupabaseClient, userId: string, site: string, started = Date.now()): Promise<Onboarded> {
  const run = firstRow(await rpcOrThrow<RunRow | RunRow[]>(supabase, "start_cmo_run", { p_kind: "onboard", p_input: { site } }));
  if (!run) throw new ApiError(500, "Could not start building your plan.");

  try {
    const snapshot = await readSite(site);
    const drafts = await draftDocuments(snapshot);
    for (const kind of DOCUMENT_KINDS) {
      await rpcOrThrow(supabase, "save_marketing_document", { p_kind: kind, p_body: drafts[kind], p_run: run.id });
    }
    await rpcOrThrow(supabase, "finish_cmo_run", { p_id: run.id, p_ok: true });
  } catch (error) {
    const known = error instanceof SiteError || error instanceof GenerateError;
    const message = known ? error.message : "We could not build your plan. Try again in a minute.";
    if (!known && !(error instanceof ApiError)) console.error("[cmo] onboarding failed", error);
    await supabase.rpc("finish_cmo_run", { p_id: run.id, p_ok: false, p_error: message });
    if (error instanceof ApiError) throw error;
    throw new ApiError(known && error instanceof SiteError ? 422 : 502, message);
  }
  // Only a founder who never had a week planned gets one at once; reading the website again rewrites the documents only.
  const { count: plans } = await supabase.from("cmo_runs").select("id", { count: "exact", head: true }).eq("kind", "plan_week");
  return { runId: run.id, firstWeek: plans === 0 ? await startFirstWeek(supabase, userId, started) : false };
}

/** The onboarding route's time limit (`maxDuration` 300 s), less a margin, from the route's start: `after()` work must end before the platform kills it. */
const ROUTE_MS = 280_000;

/**
 * Queues the week's plan and runs it, then today's draft (`kickFirstWeek`). False when the plan could not be queued
 * (paused, capped, no credits): the documents are saved either way, and the Monday plan still comes.
 */
async function startFirstWeek(supabase: SupabaseClient, userId: string, started: number): Promise<boolean> {
  const input: Record<string, unknown> = { source: "onboarding" };
  // Mode B: the plan waits in the founder's Claude inbox (`/api/v1/cmo/runs` does the same); the sweep opens it.
  if ((await brainMode(supabase, userId).catch(() => null))?.brain === "claude") input.brain = "claude";
  let plan: StartedRun;
  try {
    plan = await startCmoRun(supabase, "plan_week", input, { kick: false });
  } catch (error) {
    console.error("[cmo] could not queue the first week's plan", error);
    return false;
  }
  if (input.brain !== "claude" && plan.status === "queued") kickFirstWeek(userId, plan.id, started + ROUTE_MS);
  return true;
}
