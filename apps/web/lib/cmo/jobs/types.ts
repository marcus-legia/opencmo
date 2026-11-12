/**
 * Shared types of the CMO work queue. A plain file (not server-only), so `jobs.check.ts` can build an in-memory
 * store.
 */

import type { PostingPlan } from "../posting-plan";
import type { DocumentKind } from "../documents";
import type { VideoSource } from "../writer/types";
import type { AccountMetricRow } from "./metrics-source";

export type CmoJobKind =
  | "plan_week"
  | "post_draft"
  | "sales_scan"
  | "competitor_research"
  | "pull_metrics"
  | "summarize_memory"
  | "review_week"
  | "write_video_brief"
  | "write_caption"
  | "write_slides"
  | "publish_post"
  | "niche_video_research"
  /** cmo-review-3 2.2: the founder's draft ratings → up to five rules, free (`cmo_rate_drafts` queues it). */
  | "distill_ratings"
  /** Daily core drafts D4: the founder's "Rewrite for <platform>" on a post card (`repurpose_post` in SQL queues it). */
  | "repurpose_post";
export const CMO_JOB_KINDS: CmoJobKind[] = ["plan_week", "post_draft", "sales_scan", "competitor_research", "pull_metrics", "summarize_memory", "review_week", "write_video_brief", "write_caption", "write_slides", "publish_post", "niche_video_research", "distill_ratings", "repurpose_post"];

/** What a weekly goal counts. Only things the product can measure itself. */
export type GoalMetric = "posts" | "replies" | "views";
export type Goal = { id: string; week: string; goal: string; metric: GoalMetric; target: number; status: "proposed" | "approved" | "rejected"; result: number | null };
/** What a week reached: posts approved, Reddit replies the founder marked, views on posts. */
export type WeekResults = Record<GoalMetric, number>;

/** What a memory or a lesson is about; a job reads its own topic plus `general`. */
export type MemoryTopic = "general" | "post" | "sales" | "video" | "research";
export const MEMORY_TOPICS: MemoryTopic[] = ["general", "post", "sales", "video", "research"];

/** Tier 2: one event (a preference the founder typed, a skip reason, a result). */
export type MemoryEvent = { kind: "preference" | "fact" | "feedback" | "result"; topic: MemoryTopic; body: string; created_at: string };

/** Tier 3: a weekly lesson for one topic; `week` is the Monday it covers. */
/** A voice note as `voice_notes_for` returns it: the founder's own words from one decision, and its platform. */
/** `source`: what the note was learned from (`voice_notes_of`): an edit, a skip, or a draft approved as written. */
export type VoiceNoteRow = { body: string; platform: string | null; created_at: string; weight: number; source?: "edited" | "skipped" | "approved" | string };

/** One rated version of a draft (cmo-review-3 2.2), with the words as they were rated. */
export type DraftRating = {
  id: string;
  item_id: string;
  version: number;
  verdict: "up" | "down";
  reason_code: string | null;
  note: string | null;
  words: string;
};

export type Lesson = { week: string; topic: MemoryTopic; body: string };

/** What W7 learned from competitors: every pattern carries the URL of a post as evidence. */
export type CompetitorInsight = {
  accounts: { handle: string; posts: number; baseline: number; confidence: "low" | "ok" }[];
  hooks: { pattern: string; example: string; url: string; lift: number; why: string }[];
  formats: string[];
  ideas: { idea: string; inspired_by: string }[];
  measured_at: string;
};

/**
 * What works on short video in the founder's niche (P5 R2): standout shorts on TikTok and YouTube for the strategy's
 * topics. Only text, numbers and the URL are kept, never the video; a video without a URL from the read is dropped.
 */
export type NicheVideoInsight = {
  topics: string[];
  videos: {
    platform: "tiktok" | "youtube";
    url: string;
    author: string;
    views: number;
    /** Views over the median of the same search. */
    lift: number;
    /** The opening line as said or captioned, cut to 200 characters. */
    hook: string;
    format: string;
    why: string;
  }[];
  formats: string[];
  measured_at: string;
};

/**
 * One measurement of a published post. `source` says who read it (P6): `public` is the public reading through the
 * social reader, `zernio` the numbers of a post that went out through Zernio. Missing optional fields are unreported.
 */
export type MetricRow = {
  item_id: string;
  url: string;
  /** Null: not reported (stored as null, never zero). The public reading always has all four. */
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  source?: "public" | "zernio";
  impressions?: number | null;
  engagements?: number | null;
};

/** A post a slot published through Zernio, with the calendar item its numbers belong to. */
export type ZernioPostRow = {
  item_id: string | null;
  external_id: string;
  external_url: string | null;
  platform: string;
  social_account_id: string | null;
  zernio_account_id: string | null;
  published_at: string;
};

/** A replied thread due its outcome check (SQL `cmo_reply_outcomes_due`). `reply` is what the founder posted. */
export type ReplyOutcomeDue = {
  outcome_id: string;
  opportunity_id: string;
  platform: "reddit" | "hn";
  url: string;
  community: string;
  reply: string;
  outcome_url: string | null;
};

export type ConnectedAccountRow = { id: string; platform: AccountMetricRow["platform"]; handle: string; zernio_account_id: string };

export type StepStatus = "running" | "done" | "failed" | "skipped";
export type Step = { tool: string; label: string; status: StepStatus };

export type QueuedRun = {
  id: string;
  user_id: string;
  kind: CmoJobKind;
  input: Record<string, unknown>;
  attempt: number;
};

export type ItemStatus = "planned" | "drafting" | "in_review" | "approved" | "published" | "skipped" | "failed";

export type ItemRow = {
  id: string;
  run_id: string | null;
  department: "post" | "sales" | "video";
  platform: string;
  day: string;
  idea: string;
  reason: string;
  status: ItemStatus;
  priority: "high" | "medium" | "low";
  body: Record<string, unknown>;
  final_text: string | null;
  external_url: string | null;
  decided_at: string | null;
  published_at: string | null;
  created_at: string;
};

/** `image`: a post that gets an image from the Post image squad once the founder approves it (C3). */
/**
 * `targets`: posts only, the platform ids one core post goes to (the posting plan's slot); `platform` is the first one's
 * label. `slot`: that slot's index within its day, so saving a new plan retargets each post by it (`save_posting_plan`).
 */
export type PlanItem = { department: "post" | "sales" | "video"; platform: string; day: string; idea: string; reason: string; image?: boolean; targets?: string[]; slot?: number };

export type Documents = Partial<Record<DocumentKind, Record<string, unknown>>>;

/** One part of an opportunity's score: the number and the quote that earned it (shown in the Sales card's drawer). */
export type ScorePart = { label: "Pain" | "Fit" | "Timing" | "Reach" | "Evidence"; score: number; max: number; evidence: string };

/** A Reddit thread worth joining, ready to become a card (W4). */
export type Opportunity = {
  url: string;
  community: string;
  title: string;
  author: string;
  snippet: string;
  posted_at: string | null;
  comments: number;
  score: number;
  score_parts: ScorePart[];
  /** Empty for a skipped thread: it is kept for the Sales screen, with no draft and no card. */
  reply: string;
  /** Which model and prompt drafted the reply (`edit-taxonomy.ts`). */
  gen?: { model: string; prompt_version: string };
  /** P5 R1: the rule the draft was written under, and why ("r/x forbids self-promotion"). */
  rule?: SubredditVerdict;
  rule_why?: string;
  /** 5.1: what a member needs before posting there, when the rules say it. */
  min_karma?: number;
  min_account_age_days?: number;
  /** P6 R4: where the thread is. Omitted means Reddit (the column's default). */
  platform?: "reddit" | "hn";
};

/**
 * What a subreddit's rules allow (P5 R1, widened in 5.1): name the product (`safe`), name it only with the relation
 * stated (`requires_disclosure`), help only (`no_product_mention`), help only because the rules could not be read
 * (`not_verified`), or stay out (`skip`).
 */
export const SUBREDDIT_VERDICTS = ["safe", "requires_disclosure", "no_product_mention", "not_verified", "skip"] as const;
export type SubredditVerdict = (typeof SUBREDDIT_VERDICTS)[number];
/** Values stored before 5.1, still read from old rows and replays. */
export type LegacyVerdict = "mention_ok" | "help_only";

/** An old or new stored value → the 5.1 state; anything else reads as not verified (help only). */
export function toVerdict(value: unknown): SubredditVerdict {
  if (value === "mention_ok") return "safe";
  if (value === "help_only") return "no_product_mention";
  return (SUBREDDIT_VERDICTS as readonly unknown[]).includes(value) ? (value as SubredditVerdict) : "not_verified";
}

/** Whether a draft under this verdict may name the founder's product. */
export const mayMention = (verdict: SubredditVerdict) => verdict === "safe" || verdict === "requires_disclosure";

export type SubredditRule = {
  subreddit: string;
  verdict: SubredditVerdict;
  summary: string;
  read_at: string;
  min_karma?: number | null;
  min_account_age_days?: number | null;
  megathread?: boolean;
};
/** The founder's Sales settings (`sales_settings`). */
export type SalesSettings = { excluded: string[]; pairs: [string, string][] };

/** Who thinks for a run: OpenCMO's own models, or the founder's Claude through the inbox. */
export type Brain = "opencmo" | "claude";

/** A model call a run could not make itself, as the founder's Claude reads it in the inbox. */
export type InboxRequest = {
  /** What Claude is asked to do, one line. */
  title: string;
  /** The agent that would have answered (`lib/cmo/agents/registry.ts`). */
  agent: string;
  system: string;
  prompt: string;
  /** JSON Schema of the answer: the job validates it with the same zod schema. */
  schema: Record<string, unknown>;
};

/** What an inbox replay starts from: the answers given so far, and the step results kept between rounds. */
export type InboxState = { answers: Record<string, unknown>; memo: Record<string, unknown> };

/** Every read and write of a CMO job goes through here: Supabase (service role) for real, memory in tests. */
export interface CmoStore {
  /** The service client the spend ledger records with (provider_usage_record); test stores leave it out. */
  spendClient?: import("@/lib/api/handler").SupabaseClient;
  claim(runId?: string): Promise<QueuedRun | null>;
  step(run: QueuedRun, steps: Step[]): Promise<boolean>;
  complete(run: QueuedRun, ok: boolean, output: Record<string, unknown> | null, error: string | null): Promise<boolean>;
  documents(userId: string): Promise<Documents>;
  /**
   * Unexpired notes, most important first; with a topic, that topic plus `general`. `voice: false` leaves out the
   * voice notes (rows learned from a decision), for a writer that reads them on their own through `voiceNotes`.
   */
  memories(userId: string, limit: number, topic?: MemoryTopic, opts?: { voice?: boolean }): Promise<string[]>;
  /** The founder's voice notes (`voice_notes_for`), newest first, with a weight that falls from 1 to 0 with age. */
  voiceNotes(userId: string, limit: number): Promise<VoiceNoteRow[]>;
  /** Every note written since `since` (ISO), newest first, for the weekly summary. */
  memoryEvents(userId: string, since: string): Promise<MemoryEvent[]>;
  /** An edit's own words for its captions (read as the founder, under RLS); null when the edit is not theirs. */
  videoSource(userId: string, clipId: string): Promise<VideoSource | null>;
  /** One caption for one edit and profile (`cmo_save_caption`, which checks it again); a founder's edit is kept. */
  saveCaption(userId: string, runId: string, clipId: string, profile: string, text: string, title: string | null, gen: Record<string, unknown>): Promise<void>;
  /** Memory tier 0: the founder's active rules (`cmo_corrections`), newest first. */
  corrections(userId: string): Promise<string[]>;
  /** cmo-review-3 2.2: a rating round, and the rules the job proposes from it (no card each; the sheet accepts them). */
  ratingRound(userId: string, round: string): Promise<DraftRating[]>;
  proposeRatingRules(userId: string, round: string, rules: string[]): Promise<number>;
  /** The latest lesson for each topic. */
  lessons(userId: string): Promise<Lesson[]>;
  saveLessons(userId: string, runId: string, week: string, lessons: { topic: MemoryTopic; body: string }[]): Promise<number>;
  /** The goal for the week starting `week` (Monday), whatever its status. */
  goal(userId: string, week: string): Promise<Goal | null>;
  /** What happened since `since` (ISO), counted per goal metric. */
  weekResults(userId: string, since: string): Promise<WeekResults>;
  /** Proposes a goal for the founder to approve; null when that week's goal is already approved. */
  proposeGoal(userId: string, runId: string, week: string, goal: { goal: string; metric: GoalMetric; target: number }): Promise<Goal | null>;
  recordGoalResult(userId: string, week: string, result: number): Promise<boolean>;
  items(userId: string, filter: { statuses?: ItemStatus[]; since?: string; department?: ItemRow["department"]; limit?: number }): Promise<ItemRow[]>;
  planWeek(userId: string, runId: string, items: PlanItem[]): Promise<number>;
  /** The founder's posting plan (`profiles.posting_plan`), else the default for their connected accounts. */
  postingPlan(userId: string): Promise<PostingPlan>;
  /** Queues the drafts of this plan's posts due today, one per platform (`schedule.ts`); returns how many. */
  queueDueDrafts(run: QueuedRun): Promise<number>;
  /** The post a rewrite starts from: its core text, while it can still be rewritten (in review or approved, not posted). */
  variantSource(userId: string, itemId: string): Promise<{ text: string; platform: string } | null>;
  /** One platform's rewrite of a post (`cmo_save_variant`, which checks the length again); a new one replaces the old. */
  saveVariant(userId: string, runId: string, itemId: string, platform: string, text: string, gen: Record<string, unknown>): Promise<void>;
  saveDraft(userId: string, runId: string, itemId: string | null, idea: string, body: Record<string, unknown>, priority: ItemRow["priority"]): Promise<ItemRow>;
  /** Thread links that already became cards (dismissed ones too): W4 never offers them again. */
  seenUrls(userId: string): Promise<Set<string>>;
  saveOpportunities(userId: string, runId: string, items: Opportunity[]): Promise<number>;
  /** P5 R1: a subreddit's cached verdict (any age; the scan decides what is fresh), and saving a new one. */
  subredditRule(subreddit: string): Promise<SubredditRule | null>;
  saveSubredditRule(rule: Omit<SubredditRule, "read_at">): Promise<void>;
  salesSettings(userId: string): Promise<SalesSettings>;
  /** Product mentions in the founder's last ten posted replies (SQL `sales_mention_count_for`). */
  recentMentions(userId: string): Promise<number>;
  /** Drafts already handed out that may name the product and still wait on the founder: they count toward the rule. */
  waitingMentions(userId: string): Promise<number>;
  /** Puts the run back in the queue for `seconds` seconds; false when it was claimed again. */
  defer(run: QueuedRun, seconds: number, steps: Step[]): Promise<boolean>;
  /** W7: saves what was learned; reads the latest (Planner, X writer, CMO chat). */
  saveInsight(userId: string, runId: string, body: CompetitorInsight): Promise<void>;
  latestInsight(userId: string): Promise<CompetitorInsight | null>;
  /** P5 R2: niche video research, saved as `cmo_insights.kind = 'niche_video'`; Writer's video brief reads the latest. */
  saveNicheInsight(userId: string, runId: string, body: NicheVideoInsight): Promise<void>;
  latestNicheInsight(userId: string): Promise<NicheVideoInsight | null>;
  /** W6-lite: numbers for posted posts; only the founder's own `published` posts. */
  saveMetrics(userId: string, rows: MetricRow[]): Promise<number>;
  /** P6 A1: published slots Zernio can measure, newest first (SQL `cmo_zernio_posts`). */
  zernioPosts(userId: string, since: string): Promise<ZernioPostRow[]>;
  /** P6 A1: the founder's Zernio profile and connected accounts; no profile = nothing connected. */
  connectedAccounts(userId: string): Promise<{ zernioProfileId: string | null; accounts: ConnectedAccountRow[] }>;
  saveAccountMetrics(userId: string, rows: AccountMetricRow[]): Promise<number>;
  /** P6 A2: recomputes the founder's best hours from their numbers (SQL `best_slots_refresh`); returns hours stored. */
  refreshBestSlots(userId: string): Promise<number>;
  /** P6 A3: replies three days old and never checked. */
  replyOutcomesDue(userId: string, limit: number): Promise<ReplyOutcomeDue[]>;
  /** P6 A3: stores one check (once); false when it was already checked. */
  saveReplyOutcome(userId: string, outcomeId: string, check: { status: "found" | "not_found" | "gone"; votes: number | null; replies: number | null }): Promise<boolean>;
  /** The inbox item a replay run answers; null when it is gone or not the user's. */
  inbox(userId: string, inboxId: string): Promise<InboxState | null>;
  /** Writes the waiting model call to the run's inbox item and ends the run; null when the lease was lost. */
  openInbox(run: QueuedRun, step: string, request: InboxRequest, memo: Record<string, unknown>): Promise<string | null>;
  /** A replay ended: closes the item, or reopens it with the reason the answer failed. */
  finishInbox(run: QueuedRun, ok: boolean, feedback: string | null): Promise<void>;
}

/** The UTC date as YYYY-MM-DD, plus `offset` days. The same clock as Postgres's `current_date` (UTC). */
export function isoDay(offset = 0, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset));
  return d.toISOString().slice(0, 10);
}
