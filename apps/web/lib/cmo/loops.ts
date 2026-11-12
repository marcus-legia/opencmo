/**
 * The CMO's loops (H5, after the marketing-loops skill of marketingskills): each one declares its cadence, when it
 * runs, the job it queues and that job's input. The cron (`/api/cron/cmo`) only reads state and asks this table, so
 * adding or dropping a loop is one edit here, with a pure check (no database).
 *
 * The rule of every loop (marketing-loops): the CMO may draft on its own, never post. Every result is a card that
 * waits for approval. A loop runs once a day per founder (`schedule.ts` `queuedToday`), and one that spends credits
 * runs only when the founder set the intent (an item on the calendar), except W7 once a week.
 */

import type { CmoJobKind } from "./jobs/types";

export type LoopState = {
  /** 0 = Sunday … 6 = Saturday (UTC). */
  weekday: number;
  /** The X and Reddit items due today (the first of each); `id` is the calendar item, for linking its work order. */
  duePost: { idea: string; id?: string } | null;
  dueSales: { idea: string; id?: string } | null;
  /** Competitors in Competitor Analysis that have an X handle. */
  competitorHandles: number;
  /** Posts published in the last 14 days (to measure). */
  publishedRecently: number;
  /** Accounts connected through Zernio (P6 A1): their numbers need no social reader. */
  connectedAccounts?: number;
  /** Replies marked "replied" three or more days ago and not checked yet (P6 A3). */
  repliesDue?: number;
  /** The server has a ScrapeCreators key (or the fake). */
  socialReader: boolean;
  /**
   * The account has a plan or credits left (`cmo_require_paid`). An unpaid account had its free first run at
   * onboarding (CMO review 3, 3.1) and gets no loop: no Monday plan, no daily draft, no metrics, so the cron's log has
   * no "not enough credits" noise. Unset counts as paid (older callers and checks).
   */
  paid?: boolean;
};

export type LoopRun = { loop: string; kind: CmoJobKind; input: Record<string, unknown> };

type Loop = { name: string; cadence: string; when: (s: LoopState) => boolean; run: (s: LoopState) => LoopRun };

export const LOOPS: Loop[] = [
  {
    name: "weekly-plan",
    cadence: "Monday",
    when: (s) => s.weekday === 1,
    run: () => ({ loop: "weekly-plan", kind: "plan_week", input: { source: "schedule" } }),
  },
  {
    // Monday's post is the new plan's: `plan_week` queues its drafts when the calendar is written (`queueDueDrafts`).
    // A draft queued here beside the plan ran before the plan existed, wrote a post from no item, and left the
    // plan's Monday post for Tuesday.
    name: "daily-x-draft",
    cadence: "daily, when a post is due",
    when: (s) => Boolean(s.duePost),
    run: () => ({ loop: "daily-x-draft", kind: "post_draft", input: { source: "schedule" } }),
  },
  {
    name: "reddit-listening",
    cadence: "daily, only when a Reddit item is due (5 credits)",
    when: (s) => s.socialReader && Boolean(s.dueSales),
    run: (s) => ({ loop: "reddit-listening", kind: "sales_scan", input: { source: "schedule", brief: s.dueSales!.idea } }),
  },
  {
    name: "competitor-research",
    cadence: "Sunday, when competitors have X handles (2 credits)",
    when: (s) => s.socialReader && s.weekday === 0 && s.competitorHandles > 0,
    run: () => ({ loop: "competitor-research", kind: "competitor_research", input: { source: "schedule" } }),
  },
  {
    // Before the Monday plan: the planner reads the lessons this writes.
    name: "memory-summary",
    cadence: "Sunday (free)",
    when: (s) => s.weekday === 0,
    run: () => ({ loop: "memory-summary", kind: "summarize_memory", input: { source: "schedule" } }),
  },
  {
    // Measures the approved goal, writes the general lesson, proposes next week's goal.
    name: "weekly-review",
    cadence: "Sunday (free)",
    when: (s) => s.weekday === 0,
    run: () => ({ loop: "weekly-review", kind: "review_week", input: { source: "schedule" } }),
  },
  {
    name: "post-metrics",
    cadence: "daily, when something was published in the last 14 days, an account is connected or a reply is due a check (free)",
    when: (s) => (s.socialReader && s.publishedRecently > 0) || (s.connectedAccounts ?? 0) > 0 || (s.repliesDue ?? 0) > 0,
    run: () => ({ loop: "post-metrics", kind: "pull_metrics", input: { source: "schedule" } }),
  },
];

/** The runs to queue today for one user, in the table's order; none for an account without a plan or credits. */
export function dueLoops(state: LoopState): LoopRun[] {
  if (state.paid === false) return [];
  return LOOPS.filter((loop) => loop.when(state)).map((loop) => loop.run(state));
}
