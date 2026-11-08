import "server-only";

/**
 * W0 Onboarding (docs/cmo/san-pham.md §4.3): website → four documents → the first week, at once.
 *
 * Every write goes through an RPC as the user (web rule #1): `start_cmo_run` blocks overlapping runs and caps them at 5 a
 * day BEFORE any LLM spend; the agent writes each document with `save_marketing_document` and the run id; the run is
 * always finished, even on an error.
 *
 * The first week (cmo-review-2 S2.2): the founder should see the plan and a first draft within minutes, not with the
 * Monday plan. Planning (1 credit) and today's draft (1 credit) are queued as ordinary CMO runs, so they charge, cap and
 * show exactly as any other run, then run one after the other after the response.
 */

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";

import { brainMode } from "./brain";
import { DOCUMENT_KINDS } from "./documents";
import { draftDocuments, GenerateError } from "./generate";
import { kickCmoRunsInOrder, startCmoRun, type StartedRun } from "./jobs/start";
import { readSite, SiteError } from "./site";

type RunRow = { id: string };

export type Onboarded = { runId: string; firstWeek: boolean };

export async function runOnboarding(supabase: SupabaseClient, userId: string, site: string): Promise<Onboarded> {
  const run = firstRow(await rpcOrThrow<RunRow | RunRow[]>(supabase, "start_cmo_run", { p_kind: "onboard", p_input: { site } }));
  if (!run) throw new ApiError(500, "Could not start building your plan.");

  // Only a founder's first onboarding plans a week at once; reading the website again later rewrites the documents only.
  const { count: before } = await supabase.from("marketing_documents").select("id", { count: "exact", head: true });
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
  return { runId: run.id, firstWeek: before === 0 ? await startFirstWeek(supabase, userId) : false };
}

const CREDIT_WAIT_MS = 5_000;
const CREDIT_TRIES = 4;

/**
 * Queues the week's plan, then today's draft (which drafts the plan's first post once the plan is written). False when
 * the plan could not be queued: the documents are saved either way, and the Monday plan still comes.
 *
 * A founder who has just paid can get here before Creem's webhook grants the credits; the plan is retried for ~20 s
 * before giving up.
 */
async function startFirstWeek(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const input: Record<string, unknown> = { source: "onboarding" };
  // Mode B: the runs wait in the founder's Claude inbox (`/api/v1/cmo/runs` does the same).
  if ((await brainMode(supabase, userId).catch(() => null))?.brain === "claude") input.brain = "claude";

  let plan: StartedRun | null = null;
  for (let attempt = 1; attempt <= CREDIT_TRIES && !plan; attempt += 1) {
    try {
      plan = await startCmoRun(supabase, "plan_week", input, { kick: false });
    } catch (error) {
      const waiting = error instanceof Error && /^Not enough credits/.test(error.message) && attempt < CREDIT_TRIES;
      if (!waiting) {
        console.error("[cmo] could not queue the first week's plan", error);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, CREDIT_WAIT_MS));
    }
  }
  if (!plan) return false;

  const draft = await startCmoRun(supabase, "post_draft", input, { kick: false }).catch((error: unknown) => {
    console.error("[cmo] could not queue the first draft", error);
    return null;
  });
  if (input.brain === "claude") return true;

  // One after the other: the draft reads the plan's first post.
  kickCmoRunsInOrder([plan, draft].filter((r): r is StartedRun => r?.status === "queued").map((r) => r.id));
  return true;
}
