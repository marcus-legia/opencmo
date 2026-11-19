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

import { DOCUMENT_KINDS, type OnboardingDrafts } from "./documents";
import { draftDocuments, GenerateError } from "./generate";
import { kickCmoQueue, kickFirstWeek, startCmoRun, type StartedRun } from "./jobs/start";
import { readSite, SiteError } from "./site";

type RunRow = { id: string };

/** `firstScan`: the free Sales scan was queued (free scan plan, A4); Setup waits on it to lead to `/app/sales`. */
export type Onboarded = { runId: string; firstWeek: boolean; firstScan: boolean };

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
    // Wave 3 B4: "who do you sell to?", asked while the site was read, reaches the documents when it is in by now.
    const drafts = keepFounderBrand(await draftDocuments(snapshot, { sellsTo: await sellsTo(supabase, userId) }), await currentBrand(supabase, userId));
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
  // The people asking come first (free scan plan, A4): the scan is queued and kicked before the week's plan.
  const firstScan = await startFirstScan(supabase, started);
  // Only a founder whose first week never got going gets one at once; reading the website again otherwise rewrites the
  // documents only. A failed first plan or draft does not count, so reading the site again retries it (free once for an
  // account without a plan: `cmo_first_run_free`).
  const live = (kind: "plan_week" | "post_draft") =>
    supabase.from("cmo_runs").select("status, input").eq("kind", kind).neq("status", "failed").limit(20);
  const [{ data: plans }, { data: drafts }] = await Promise.all([live("plan_week"), live("post_draft")]);
  // A run sent to the founder's Claude inbox (removed 2026-11-14) ended "done" without writing anything: it does not
  // count, so a founder left with one gets their first week now.
  type Row = { status: string; input: { brain?: unknown } | null };
  const real = (rows: unknown) => ((rows ?? []) as Row[]).filter((row) => row.input?.brain !== "claude");
  const planRows = real(plans);
  if (planRows.length === 0) return { runId: run.id, firstWeek: await startFirstWeek(supabase, userId, started), firstScan };
  // The plan is done and its draft failed: draft again. Not while the plan still runs (its own trigger drafts).
  const planDone = planRows.some((row) => row.status === "done");
  if (planDone && real(drafts).length === 0) return { runId: run.id, firstWeek: await startFirstDraft(supabase), firstScan };
  return { runId: run.id, firstWeek: false, firstScan };
}

/** The Brand the founder already has, when the website is read again; null on the first read. */
async function currentBrand(supabase: SupabaseClient, userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("marketing_documents_latest").select("body").eq("user_id", userId).eq("kind", "brand").maybeSingle<{ body: Record<string, unknown> }>();
  return error ? null : (data?.body ?? null);
}

/**
 * Reading the website again rewrites the documents, but what the founder put in the Brand themselves (writing samples,
 * screenshots, their intro line) is not the website's to replace.
 */
export function keepFounderBrand(drafts: OnboardingDrafts, current: Record<string, unknown> | null): OnboardingDrafts {
  if (!current) return drafts;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []);
  const look = current.look && typeof current.look === "object" ? (current.look as Record<string, unknown>) : {};
  const samples = list(current.voice_samples);
  const shots = list(look.screenshots);
  const intro = typeof current.intro_line === "string" ? current.intro_line.trim() : "";
  return {
    ...drafts,
    brand: {
      ...drafts.brand,
      ...(samples.length ? { voice_samples: samples } : {}),
      ...(intro ? { intro_line: intro } : {}),
      look: { ...drafts.brand.look, ...(shots.length ? { screenshots: shots } : {}) },
    },
  };
}

/** The founder's answer to "who do you sell to?" (`profiles.sells_to`); null when unanswered or not stored yet. */
async function sellsTo(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase.from("profiles").select("sells_to").eq("id", userId).maybeSingle<{ sells_to: string | null }>();
  // Before the column exists (A's sells_to answer) the read fails: the documents come from the website alone.
  if (error) return null;
  return data?.sells_to?.trim() || null;
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

/** What the scan may take in `after()`: started later than this before the route's deadline, it waits for the sweep. */
const SCAN_MS = 150_000;

/**
 * Queues the founder's first Sales scan, once: none that is queued, running or done yet (a failed one is tried again,
 * as `cmo_first_run_free` gives the free scan back). It goes through the queue, never inline: the documents are saved
 * and the route answers at once. False when it was not queued: Sales not set up on this server (503), paused, capped,
 * or no plan after the free one. Onboarding goes on either way; Sales then shows what is missing.
 */
async function startFirstScan(supabase: SupabaseClient, started: number): Promise<boolean> {
  const { data, error } = await supabase.from("cmo_runs").select("id").eq("kind", "sales_scan").neq("status", "failed").limit(1);
  if (error) {
    console.error("[cmo] could not read the Sales runs", error.message);
    return false;
  }
  if ((data ?? []).length > 0) return false;
  // Only the free scan starts on its own. A paid founder's scan costs credits, and every paid scan is one they ask for
  // (review of #238: reading the site again queued a paid scan nobody approved).
  const usage = await supabase.rpc("plan_usage");
  if (usage.error) {
    console.error("[cmo] could not read the plan before the first scan", usage.error.message);
    return false;
  }
  const row = (Array.isArray(usage.data) ? usage.data[0] : usage.data) as { plan?: string } | null;
  if (row?.plan !== "free") return false;
  let scan: StartedRun;
  try {
    scan = await startCmoRun(supabase, "sales_scan", { source: "onboarding" }, { kick: false });
  } catch (error) {
    console.error("[cmo] could not queue the first Sales scan", error);
    return false;
  }
  const left = started + ROUTE_MS - Date.now();
  if (scan.status === "queued" && left > SCAN_MS) kickCmoQueue(scan.id, left - 5_000);
  return true;
}

/**
 * Queues the week's plan and runs it, then today's draft (`kickFirstWeek`). False when the plan could not be queued
 * (paused, capped, no credits, no plan after the free one): the documents are saved either way.
 */
async function startFirstWeek(supabase: SupabaseClient, userId: string, started: number): Promise<boolean> {
  // The first week plans posts even before the free scan fills the Library (`planWeek`, onboarding exception).
  const input: Record<string, unknown> = { source: "onboarding" };
  let plan: StartedRun;
  try {
    plan = await startCmoRun(supabase, "plan_week", input, { kick: false });
  } catch (error) {
    console.error("[cmo] could not queue the first week's plan", error);
    return false;
  }
  if (plan.status === "queued") kickFirstWeek(userId, plan.id, started + ROUTE_MS);
  return true;
}
