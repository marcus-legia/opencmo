import "server-only";

/**
 * W0 Onboarding (docs/cmo/san-pham.md §4.3): website → four documents → the first week, at once.
 *
 * Every write goes through an RPC as the user (web rule #1): `start_cmo_run` blocks overlapping runs and caps them at 5 a
 * day BEFORE any LLM spend; the agent writes each document with `save_marketing_document` and the run id; the run is
 * always finished, even on an error.
 *
 * The first week (cmo-review-2 S2.2): the founder should see the plan and a first draft within minutes, not with the
 * Monday plan. Planning and today's draft are ordinary CMO runs, so they cap and show exactly as any other run; the
 * draft is queued once the plan is written. The first of each is free for an account without a plan (CMO review 3,
 * 3.1: `cmo_first_run_free`, read from history in `cmo_enqueue`); later ones cost 1 credit each.
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

/** `started`: when the route began, so the first week's deadline counts everything before the model work. */
export async function runOnboarding(supabase: SupabaseClient, userId: string, site: string, started = Date.now()): Promise<Onboarded> {
  const run = firstRow(await rpcOrThrow<RunRow | RunRow[]>(supabase, "start_cmo_run", { p_kind: "onboard", p_input: { site } }));
  if (!run) throw new ApiError(500, "Could not start building your plan.");

  const steps = progress(supabase, run.id);
  try {
    await steps.set("site", "running");
    const snapshot = await readSite(site);
    await steps.set("site", "done");
    await steps.set(DOCUMENT_KINDS[0], "running");
    const drafts = await draftDocuments(snapshot);
    for (const [index, kind] of DOCUMENT_KINDS.entries()) {
      await rpcOrThrow(supabase, "save_marketing_document", { p_kind: kind, p_body: drafts[kind], p_run: run.id });
      await steps.set(kind, "done");
      const next = DOCUMENT_KINDS[index + 1];
      if (next) await steps.set(next, "running");
    }
    // Answers given while the run worked (CMO review 3, 3.2) reach the documents before the first plan reads them.
    await supabase.rpc("cmo_onboarding_answers", { p_answers: {} }).then(({ error }) => {
      if (error) console.warn("[cmo] onboarding answers not applied", error.message);
    });
    await rpcOrThrow(supabase, "finish_cmo_run", { p_id: run.id, p_ok: true });
  } catch (error) {
    await steps.fail();
    const known = error instanceof SiteError || error instanceof GenerateError;
    const message = known ? error.message : "We could not build your plan. Try again in a minute.";
    if (!known && !(error instanceof ApiError)) console.error("[cmo] onboarding failed", error);
    await supabase.rpc("finish_cmo_run", { p_id: run.id, p_ok: false, p_error: message });
    if (error instanceof ApiError) throw error;
    throw new ApiError(known && error instanceof SiteError ? 422 : 502, message);
  }
  // Only a founder whose first week never got going gets one at once; reading the website again otherwise rewrites the
  // documents only. A failed first plan or draft does not count, so reading the site again retries it (free once for an
  // account without a plan: `cmo_first_run_free`).
  const live = (kind: "plan_week" | "post_draft") =>
    supabase.from("cmo_runs").select("id", { count: "exact", head: true }).eq("kind", kind).neq("status", "failed");
  const [{ count: plans }, { count: drafts }] = await Promise.all([live("plan_week"), live("post_draft")]);
  if (plans === 0) return { runId: run.id, firstWeek: await startFirstWeek(supabase, userId, started) };
  if (drafts === 0) return { runId: run.id, firstWeek: await startFirstDraft(supabase) };
  return { runId: run.id, firstWeek: false };
}

/** The plan is there but its first draft failed: queue the draft again (the plan's own trigger only queues it once). */
async function startFirstDraft(supabase: SupabaseClient): Promise<boolean> {
  try {
    await startCmoRun(supabase, "post_draft", { source: "onboarding" });
    return true;
  } catch (error) {
    console.error("[cmo] could not queue the first draft again", error);
    return false;
  }
}

/** The step ids Setup words (`lib/cmo/onboard-status.ts`): the website, then each document as it is saved. */
export type OnboardStepId = "site" | (typeof DOCUMENT_KINDS)[number];
type StepState = "running" | "done" | "failed";

/**
 * The run's real steps (CMO review 3, 3.2), written as the founder (`cmo_onboard_step`). Best effort: a step that
 * cannot be written never stops onboarding, Setup only shows less.
 */
function progress(supabase: SupabaseClient, runId: string) {
  const list: { id: OnboardStepId; status: StepState }[] = [];
  const write = async () => {
    const { error } = await supabase.rpc("cmo_onboard_step", { p_run: runId, p_steps: list });
    if (error) console.warn("[cmo] onboarding step not written", error.message);
  };
  return {
    async set(id: OnboardStepId, status: StepState) {
      const found = list.find((step) => step.id === id);
      if (found) found.status = status;
      else list.push({ id, status });
      await write();
    },
    async fail() {
      const running = list.find((step) => step.status === "running");
      if (!running) return;
      running.status = "failed";
      await write();
    },
  };
}

/** The onboarding route's time limit (`maxDuration` 300 s), less a margin, from the route's start: `after()` work must end before the platform kills it. */
const ROUTE_MS = 280_000;

/**
 * Queues the week's plan and runs it, then today's draft (`kickFirstWeek`). False when the plan could not be queued
 * (paused, capped, no credits, no plan after the free one): the documents are saved either way.
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
