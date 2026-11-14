/**
 * Runs the CMO work queue (docs/cmo/san-pham.md §4.3–4.4). One run = one job (W1, W2…); each step is written to
 * `cmo_runs.steps` BEFORE and AFTER it runs, so Activity shows every step and a run that died midway (lease ran out)
 * can run again from the top.
 *
 * Không `server-only`: `jobs.check.ts` chạy runner với store trong bộ nhớ.
 */

import type { z } from "zod";

import { competitorResearch } from "./competitor-research";
import { distillRatings } from "./distill-ratings";
import { photoCaption } from "./photo-caption";
import { repurposePost } from "./repurpose-post";
import { nicheVideoResearch } from "./niche-video-research";
import { draftPost } from "./draft-post";
import { LlmError } from "./llm-error";
import { planWeek } from "./plan-week";
import { pullMetrics } from "./pull-metrics";
import { reviewWeek } from "./review-week";
import { salesScan, type ConversationSearch } from "./sales-scan";
import type { HnThread } from "../social/hn";
import { maxSteps } from "../step-limits";
import type { RedditThread } from "../social/reddit";
import { summarizeMemory } from "./summarize-memory";
import { writeCaption, writeVideoBrief } from "../writer/jobs";
import type { PublishAnalytics } from "@/lib/departments/publish/analytics";
import { publishPost } from "@/lib/departments/publish/job";
import { think, type ThinkOptions } from "./think";
import type { CmoJobKind, CmoStore, QueuedRun, Step } from "./types";
import { SocialReadError } from "@/lib/cmo/social/scrapecreators";
import { assertSpendAllowed, SPEND_CAP_MESSAGE, SpendCapError, withSpend } from "@/lib/spend/record";

/**
 * Work that cannot go on yet (e.g. waiting for something outside): throw this, and the run goes back to the queue for
 * `seconds` seconds. Not a failure, no refund.
 */
export class Deferred extends Error {
  constructor(readonly seconds: number) {
    super("deferred");
  }
}

export type JobContext = {
  store: CmoStore;
  run: QueuedRun;
  /** Runs one step named by tool and label; `done` turns its result into the finished label (or keeps the label). */
  step<T>(tool: string, label: string, fn: () => Promise<T>, done?: (value: T) => string): Promise<T>;
  /** The run's clock, read once when it starts, so every step of one run sees the same week. */
  now: Date;
  /** One structured model call (`think.ts`). */
  think<S extends z.ZodType>(opts: ThinkOptions<S>): Promise<z.infer<S>>;
  /** Stands in for the Reddit search (evals, checks); production leaves it unset. */
  searchReddit?: (query: string) => Promise<RedditThread[]>;
  /** Stands in for the Hacker News search (P6 R4: evals, checks); production leaves it unset. */
  searchHn?: (query: string) => Promise<HnThread[]>;
  /** Stands in for the Facebook groups and Threads finders (Sales finder B1: evals, checks); production leaves it unset. */
  searchConversations?: ConversationSearch;
  /** Stands in for Zernio's analytics (checks); unset = picked from env like the publish adapter, null = none. */
  analytics?: PublishAnalytics | null;
};

export type RunOptions = {
  searchReddit?: JobContext["searchReddit"];
  searchHn?: JobContext["searchHn"];
  searchConversations?: JobContext["searchConversations"];
  analytics?: JobContext["analytics"];
  /** Stands in for the model (checks that read the request a job sends); production leaves it unset. */
  think?: JobContext["think"];
};

export type JobOutput = Record<string, unknown>;
type Job = (ctx: JobContext) => Promise<JobOutput>;

export const JOBS: Record<CmoJobKind, Job> = {
  plan_week: planWeek,
  post_draft: draftPost,
  sales_scan: salesScan,
  competitor_research: competitorResearch,
  pull_metrics: pullMetrics,
  summarize_memory: summarizeMemory,
  review_week: reviewWeek,
  write_video_brief: writeVideoBrief,
  write_caption: writeCaption,
  // P4: only Schedule's sweep queues it (enqueue_cmo_run refuses it), for one approved slot.
  publish_post: publishPost,
  niche_video_research: nicheVideoResearch,
  // cmo-review-3 2.2: only `cmo_rate_drafts` queues it, for one round of the founder's ratings.
  distill_ratings: distillRatings,
  // Daily core drafts D4: only the founder's Rewrite button queues it (SQL `repurpose_post`), for one post and platform.
  repurpose_post: repurposePost,
  // Daily core drafts D7: only the founder's "Write the caption" on a photo post queues it (SQL `photo_post_caption`).
  photo_caption: photoCaption,
};

/** The run was claimed again by another worker (its lease ran out): stop quietly and write nothing more. */
class LeaseLost extends Error {}

export async function runOne(store: CmoStore, run: QueuedRun, opts: RunOptions = {}): Promise<{ ok: boolean; error: string | null; deferred?: boolean }> {
  const steps: Step[] = [];
  // Writes go one after another, each with the steps as they are when it starts: steps that run side by side (Writer's
  // captions) never land an older list over a newer one.
  let saving: Promise<unknown> = Promise.resolve();
  const save = (): Promise<boolean> => {
    const next = saving.then(() => store.step(run, steps));
    saving = next.catch(() => false);
    return next;
  };
  const write = async () => {
    if (!(await save())) throw new LeaseLost();
  };
  const now = new Date();
  // cmo-review B3.3: the registry's `max_steps` for this kind, enforced here (a job in a loop fails and is refunded).
  const stepLimit = maxSteps(run.kind);

  const ctx: JobContext = {
    store,
    run,
    async step(tool, label, fn, done) {
      if (stepLimit !== null && steps.length >= stepLimit) {
        throw new LlmError(`This task took more than ${stepLimit} steps, so it was stopped. Your credits were refunded; try again.`);
      }
      steps.push({ tool, label, status: "running" });
      const index = steps.length - 1;
      await write();
      try {
        const value = await fn();
        steps[index] = { tool, label: done ? done(value) : label, status: "done" };
        await write();
        return value;
      } catch (error) {
        // Waiting (Deferred) is not a failure: Activity says so.
        steps[index] = { tool, label, status: error instanceof Deferred ? "running" : "failed" };
        await save().catch(() => false);
        throw error;
      }
    },
    now,
    think: opts.think ?? ((call) => think(call)),
    searchReddit: opts.searchReddit,
    searchHn: opts.searchHn,
    searchConversations: opts.searchConversations,
    ...(opts.analytics !== undefined ? { analytics: opts.analytics } : {}),
  };

  const job = JOBS[run.kind];
  if (!job) {
    await store.complete(run, false, null, "Unknown task.");
    return { ok: false, error: "Unknown task." };
  }
  let output: JobOutput;
  try {
    // Every paid provider call of the job is recorded for this founder and run, and refused past their daily cap.
    output = store.spendClient
      ? await withSpend({ via: "service", client: store.spendClient, userId: run.user_id, refKind: "cmo_run", refId: run.id }, async () => {
          await assertSpendAllowed();
          return job(ctx);
        })
      : await job(ctx);
  } catch (error) {
    if (error instanceof LeaseLost) return { ok: false, error: null };
    if (error instanceof Deferred) {
      await store.defer(run, error.seconds, steps).catch((e) => console.error("[cmo] cmo_defer_run", e));
      return { ok: true, error: null, deferred: true };
    }
    // Past the daily cap the run fails with the founder message; complete_cmo_run returns its credits.
    const capped = error instanceof SpendCapError || (error instanceof SocialReadError && error.kind === "cap");
    const message = capped ? SPEND_CAP_MESSAGE : error instanceof LlmError ? error.message : "Something went wrong. Try again in a minute.";
    if (!(error instanceof LlmError) && !capped) console.error(`[cmo] ${run.kind} ${run.id} failed`, error);
    await store.complete(run, false, null, message).catch((e) => console.error("[cmo] complete_cmo_run", e));
    return { ok: false, error: message };
  }
  // The job's work is written: a store error from here on is ours, not the job's. It is thrown, so the lease runs out
  // and the run is claimed again, instead of failing a finished job and refunding it (review follow-up Q10).
  await store.complete(run, true, output, null);
  return { ok: true, error: null };
}

/**
 * Claims and runs work until the queue is empty or the time budget is spent. With `runId`, only that run (the founder
 * just asked for it); the others are left to the cron.
 */
export async function drainCmoQueue(store: CmoStore, opts: { runId?: string; budgetMs?: number } & RunOptions = {}): Promise<number> {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  let ran = 0;
  while (Date.now() < deadline) {
    const run = await store.claim(opts.runId);
    if (!run) break;
    try {
      await runOne(store, run, { searchReddit: opts.searchReddit, searchHn: opts.searchHn, searchConversations: opts.searchConversations, analytics: opts.analytics, think: opts.think });
    } catch (error) {
      // Our store failed (completing a finished job): the run keeps its lease and is claimed
      // again when it runs out. The other runs in this drain still go.
      console.error(`[cmo] ${run.kind} ${run.id}: store error, left for the lease to retry`, error);
    }
    ran += 1;
    if (opts.runId) break;
  }
  return ran;
}
