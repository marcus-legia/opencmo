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
import { repurposePost } from "./repurpose-post";
import { nicheVideoResearch } from "./niche-video-research";
import { draftPost } from "./draft-post";
import { LlmError } from "./llm-error";
import { planWeek } from "./plan-week";
import { pullMetrics } from "./pull-metrics";
import { reviewWeek } from "./review-week";
import { salesScan } from "./sales-scan";
import type { HnThread } from "../social/hn";
import { maxSteps } from "../step-limits";
import type { RedditThread } from "../social/reddit";
import { summarizeMemory } from "./summarize-memory";
import { writeCaption, writeSlides, writeVideoBrief } from "../writer/jobs";
import type { PublishAnalytics } from "@/lib/departments/publish/analytics";
import { publishPost } from "@/lib/departments/publish/job";
import { NeedsClaude, think, type ThinkOptions } from "./think";
import type { Brain, CmoJobKind, CmoStore, InboxState, QueuedRun, Step } from "./types";
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
  /** Who thinks for this run. With `claude`, model calls go to the inbox and checker calls are skipped. */
  brain: Brain;
  /**
   * Runs one step named by tool and label; `done` turns its result into the finished label (or keeps the label).
   * `memo`: a key under which an inbox run keeps the result for its replays, so a step that reads
   * the outside world (a Reddit search) runs once and the answers given about what it found stay
   * valid. The result must be plain JSON.
   */
  step<T>(tool: string, label: string, fn: () => Promise<T>, done?: (value: T) => string, opts?: { memo?: string }): Promise<T>;
  /**
   * A read of the outside world or the database inside a step, kept for an inbox run's replays under `key` (plain JSON
   * only), so the list the founder's Claude answered about is the list its answers are applied to.
   */
  once<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** The run's clock: for an inbox run, the time of its first attempt, so a replay a day later is the same week. */
  now: Date;
  /** One structured model call (`think.ts`). */
  think<S extends z.ZodType>(opts: ThinkOptions<S>): Promise<z.infer<S>>;
  /** Stands in for the Reddit search (evals, checks); production leaves it unset. */
  searchReddit?: (query: string) => Promise<RedditThread[]>;
  /** Stands in for the Hacker News search (P6 R4: evals, checks); production leaves it unset. */
  searchHn?: (query: string) => Promise<HnThread[]>;
  /** Stands in for Zernio's analytics (checks); unset = picked from env like the publish adapter, null = none. */
  analytics?: PublishAnalytics | null;
};

const NOW_KEY = "__now";

/** True for values that survive the JSON round trip of the inbox memo unchanged (no Set, Map, Date, undefined). */
export function isPlainJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainJson);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value as Record<string, unknown>).every((v) => v !== undefined && isPlainJson(v));
  }
  return false;
}

/** The inbox memo is capped at 1 MB in SQL: an automatic entry stays small, so the explicit ones always fit. */
const MEMO_ENTRY_MAX = 100_000;
const memoable = (value: unknown) => isPlainJson(value) && JSON.stringify(value).length <= MEMO_ENTRY_MAX;

export type RunOptions = {
  searchReddit?: JobContext["searchReddit"];
  searchHn?: JobContext["searchHn"];
  analytics?: JobContext["analytics"];
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
  write_slides: writeSlides,
  // P4: only Schedule's sweep queues it (enqueue_cmo_run refuses it), for one approved slot.
  publish_post: publishPost,
  niche_video_research: nicheVideoResearch,
  // cmo-review-3 2.2: only `cmo_rate_drafts` queues it, for one round of the founder's ratings.
  distill_ratings: distillRatings,
  // Daily core drafts D4: only the founder's Rewrite button queues it (SQL `repurpose_post`), for one post and platform.
  repurpose_post: repurposePost,
};

/** The run was claimed again by another worker (its lease ran out): stop quietly and write nothing more. */
class LeaseLost extends Error {}

export async function runOne(store: CmoStore, run: QueuedRun, opts: RunOptions = {}): Promise<{ ok: boolean; error: string | null; deferred?: boolean; inbox?: string }> {
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
  const brain: Brain = run.input.brain === "claude" ? "claude" : "opencmo";
  const inboxId = brain === "claude" && typeof run.input.inbox === "string" ? run.input.inbox : null;
  const finish = async (ok: boolean, feedback: string | null) => {
    if (inboxId) await store.finishInbox(run, ok, feedback).catch((e) => console.error("[cmo] cmo_inbox_finish", e));
  };
  let inbox: InboxState = { answers: {}, memo: {} };
  if (inboxId) {
    const found = await store.inbox(run.user_id, inboxId);
    if (!found) {
      await store.complete(run, false, null, "This inbox item is gone.");
      return { ok: false, error: "This inbox item is gone." };
    }
    inbox = found;
  }
  const memo: Record<string, unknown> = { ...inbox.memo };
  // Inbox replays re-run the job from the top while Claude's answers stay fixed (keyed by step label, indexed into the
  // lists it was shown). Every finished step's plain-JSON result and the first attempt's clock are kept, so a replay
  // rebuilds the same lists instead of re-reading a database and a clock that have moved on.
  if (brain === "claude" && typeof memo[NOW_KEY] !== "string") memo[NOW_KEY] = new Date().toISOString();
  const now = brain === "claude" ? new Date(memo[NOW_KEY] as string) : new Date();
  let stepNumber = 0;
  // cmo-review B3.3: the registry's `max_steps` for this kind, enforced here (a job in a loop fails and is refunded).
  const stepLimit = maxSteps(run.kind);

  const ctx: JobContext = {
    store,
    run,
    brain,
    async step(tool, label, fn, done, opts) {
      if (stepLimit !== null && steps.length >= stepLimit) {
        throw new LlmError(`This task took more than ${stepLimit} steps, so it was stopped. Your credits were refunded; try again.`);
      }
      steps.push({ tool, label, status: "running" });
      const index = steps.length - 1;
      await write();
      // Counted before the step runs, so the key is the same on every replay (steps run in the same order).
      const auto = `step:${stepNumber++}:${tool}`;
      try {
        const key = brain === "claude" ? (opts?.memo ?? auto) : undefined;
        const value = key && Object.hasOwn(memo, key) ? (memo[key] as Awaited<ReturnType<typeof fn>>) : await fn();
        // An explicit key is the job's promise that the value is plain JSON; an automatic one is checked.
        if (key && (opts?.memo || memoable(value))) memo[key] = value;
        steps[index] = { tool, label: done ? done(value) : label, status: "done" };
        await write();
        return value;
      } catch (error) {
        // Waiting (Deferred, the inbox) is not a failure: Activity says so.
        steps[index] =
          error instanceof NeedsClaude
            ? { tool, label: "Waiting for your Claude (Inbox)", status: "skipped" }
            : { tool, label, status: error instanceof Deferred ? "running" : "failed" };
        await save().catch(() => false);
        throw error;
      }
    },
    async once(key, fn) {
      if (brain !== "claude") return fn();
      const at = `once:${key}`;
      if (Object.hasOwn(memo, at)) return memo[at] as Awaited<ReturnType<typeof fn>>;
      const value = await fn();
      if (memoable(value)) memo[at] = value;
      return value;
    },
    now,
    think: (opts) => think(opts, brain, inbox.answers),
    searchReddit: opts.searchReddit,
    searchHn: opts.searchHn,
    ...(opts.analytics !== undefined ? { analytics: opts.analytics } : {}),
  };

  const job = JOBS[run.kind];
  if (!job) {
    await store.complete(run, false, null, "Unknown task.");
    await finish(false, "Unknown task.");
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
    if (error instanceof NeedsClaude) {
      // Ends the run in the same call: nothing else is written for it.
      try {
        const id = await store.openInbox(run, error.step, error.request, memo);
        return id ? { ok: true, error: null, inbox: id } : { ok: false, error: null };
      } catch (openError) {
        console.error(`[cmo] ${run.kind} ${run.id}: cmo_inbox_open`, openError);
        const message = "Could not send this task to your Claude inbox. Try again in a minute.";
        await store.complete(run, false, null, message).catch((e) => console.error("[cmo] complete_cmo_run", e));
        return { ok: false, error: message };
      }
    }
    // Past the daily cap the run fails with the founder message; complete_cmo_run returns its credits.
    const capped = error instanceof SpendCapError || (error instanceof SocialReadError && error.kind === "cap");
    const message = capped ? SPEND_CAP_MESSAGE : error instanceof LlmError ? error.message : "Something went wrong. Try again in a minute.";
    if (!(error instanceof LlmError) && !capped) console.error(`[cmo] ${run.kind} ${run.id} failed`, error);
    await store.complete(run, false, null, message).catch((e) => console.error("[cmo] complete_cmo_run", e));
    await finish(false, message);
    return { ok: false, error: message };
  }
  // The job's work is written: a store error from here on is ours, not the job's. It is thrown, so the lease runs out
  // and the run is claimed again, instead of failing a finished job and refunding it (review follow-up Q10).
  await store.complete(run, true, output, null);
  await finish(true, null);
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
      await runOne(store, run, { searchReddit: opts.searchReddit, searchHn: opts.searchHn, analytics: opts.analytics });
    } catch (error) {
      // Our store failed (reading the inbox, or completing a finished job): the run keeps its lease and is claimed
      // again when it runs out. The other runs in this drain still go.
      console.error(`[cmo] ${run.kind} ${run.id}: store error, left for the lease to retry`, error);
    }
    ran += 1;
    if (opts.runId) break;
  }
  return ran;
}
