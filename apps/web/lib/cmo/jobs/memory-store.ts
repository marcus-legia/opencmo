/**
 * An in-memory `CmoStore` for checks and evals: the same job code runs against it without
 * Supabase. Not `server-only`, so `tsx` scripts can import it.
 */

import type { VideoSource } from "../writer/types";
import { latestPerTopic } from "./context";
import { isoDay, type CmoStore, type DraftRating, type CompetitorInsight, type ConnectedAccountRow, type ReplyOutcomeDue, type MetricRow, type ZernioPostRow, type NicheVideoInsight, type SalesSettings, type SubredditRule, type Documents, type Goal, type ItemRow, type Lesson, type MemoryEvent, type Opportunity, type QueuedRun, type Step, type VoiceNoteRow, type WeekResults } from "./types";
import type { AccountMetricRow } from "./metrics-source";
import { defaultPostingPlan, type PostingPlan } from "../posting-plan";
import { SALES_PLATFORMS } from "../social/conversations";

export type RunState = QueuedRun & { status: string; steps: Step[]; error: string | null; output: unknown; notBefore?: number };

export function memoryStore(docs: Documents, memories: string[] = ["Skipped the X post \"Pricing\": too salesy"], events: MemoryEvent[] = [], corrections: string[] = []) {
  /** Voice notes as `voice_notes_for` would return them; tests push rows here, newest first. */
  const voice: VoiceNoteRow[] = [];
  /** Edits a caption run can read, and the captions it saved (`edited`: the founder's own, never overwritten). */
  const videos: VideoSource[] = [];
  /** One platform's rewrite of a post (`post_variants`). */
  const variants: { runId: string; itemId: string; platform: string; text: string; gen: Record<string, unknown> }[] = [];
  /** Photo posts' captions, by post id. */
  const photoCaptions = new Map<string, string>();
  const captions: { runId: string; clipId: string; profile: string; text: string; title: string | null; gen: Record<string, unknown>; edited: boolean }[] = [];
  const lessons: Lesson[] = [];
  const goals: Goal[] = [];
  const results: WeekResults = { posts: 0, replies: 0, views: 0 };
  const runs: RunState[] = [];
  const items: ItemRow[] = [];
  const opps: Opportunity[] = [];
  const rules = new Map<string, SubredditRule>();
  const salesSettings: SalesSettings = { excluded: [], pairs: [], platforms: [...SALES_PLATFORMS] };
  const mentions = { used: 0 };
  const insights: CompetitorInsight[] = [];
  const niche: NicheVideoInsight[] = [];
  const metrics: MetricRow[] = [];
  const zernio: { profileId: string | null; accounts: ConnectedAccountRow[]; posts: ZernioPostRow[]; days: AccountMetricRow[] } = {
    profileId: null,
    accounts: [],
    posts: [],
    days: [],
  };
  /** cmo-review-3 2.2: rating rounds by id, and the rules each one proposed. */
  const ratings = new Map<string, DraftRating[]>();
  const ratingRules = new Map<string, string[]>();
  const replies: (ReplyOutcomeDue & { check?: { status: string; votes: number | null; replies: number | null } })[] = [];
  /** The founder's saved posting plan; null = never chosen, the default for the connected accounts applies. */
  const posting: { plan: PostingPlan | null } = { plan: null };
  let seq = 0;
  const id = () => `id-${++seq}`;
  const store: CmoStore = {
    async claim(runId) {
      const run = runs.find((r) => r.status === "queued" && (!runId || r.id === runId) && (!r.notBefore || r.notBefore <= Date.now()));
      if (!run) return null;
      run.status = "running";
      run.attempt += 1;
      return { id: run.id, user_id: run.user_id, kind: run.kind, input: run.input, attempt: run.attempt };
    },
    async step(run, steps) {
      const r = runs.find((x) => x.id === run.id)!;
      if (r.attempt !== run.attempt || r.status !== "running") return false;
      r.steps = steps.map((s) => ({ ...s }));
      return true;
    },
    async complete(run, ok, output, error) {
      const r = runs.find((x) => x.id === run.id)!;
      r.status = ok ? "done" : "failed";
      r.output = output;
      r.error = error;
      return true;
    },
    documents: async () => docs,
    memories: async () => memories,
    voiceNotes: async (_u, limit) => voice.slice(0, limit),
    videoSource: async (_u, clipId) => videos.find((video) => video.clipId === clipId) ?? null,
    async saveCaption(_u, runId, clipId, profile, text, title, gen) {
      const at = captions.findIndex((c) => c.clipId === clipId && c.profile === profile);
      if (at >= 0 && captions[at]!.edited) return;
      const row = { runId, clipId, profile, text, title, gen, edited: false };
      if (at >= 0) captions[at] = row;
      else captions.push(row);
    },
    memoryEvents: async () => events,
    corrections: async () => corrections,
    ratingRound: async (_u, round) => ratings.get(round) ?? [],
    async proposeRatingRules(_u, round, rules) {
      if (!ratings.has(round)) throw new Error("No ratings in this round.");
      if (ratingRules.has(round)) return 0;
      const kept = rules.slice(0, 5).map((r) => r.trim()).filter((r) => r.length >= 3 && r.length <= 200);
      ratingRules.set(round, kept);
      return kept.length;
    },
    lessons: async () => latestPerTopic([...lessons].sort((a, b) => b.week.localeCompare(a.week))),
    goal: async (_u, week) => goals.find((g) => g.week === week) ?? null,
    weekResults: async () => ({ ...results }),
    async proposeGoal(_u, _run, week, goal) {
      const at = goals.findIndex((g) => g.week === week);
      if (at >= 0 && goals[at]!.status === "approved") return null;
      if (at >= 0) goals.splice(at, 1);
      const row: Goal = { id: id(), week, ...goal, status: "proposed", result: null };
      goals.push(row);
      return row;
    },
    async recordGoalResult(_u, week, result) {
      const goal = goals.find((g) => g.week === week && g.status === "approved");
      if (goal) goal.result = result;
      return Boolean(goal);
    },
    async saveLessons(_u, _run, week, list) {
      for (const l of list) {
        const at = lessons.findIndex((x) => x.week === week && x.topic === l.topic);
        if (at >= 0) lessons.splice(at, 1);
        lessons.push({ week, topic: l.topic, body: l.body });
      }
      return list.length;
    },
    async items(_u, f) {
      return items.filter((i) => (!f.statuses || f.statuses.includes(i.status)) && (!f.department || i.department === f.department));
    },
    async planWeek(_u, runId, plan) {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].status === "planned") items.splice(i, 1);
      for (const p of plan) {
        const { targets, slot, ...item } = p;
        // As `cmo_plan_week` writes it: a post keeps its slot's platforms in `body.targets` and its index in `body.slot`.
        items.push({ id: id(), run_id: runId, ...item, status: "planned", priority: "medium", body: targets?.length ? { targets, ...(slot === undefined ? {} : { slot }) } : {}, final_text: null, external_url: null, decided_at: null, published_at: null, created_at: new Date().toISOString() });
      }
      return plan.length;
    },
    postingPlan: async () => posting.plan ?? defaultPostingPlan(zernio.accounts.map((a) => a.platform)),
    async queueDueDrafts(run) {
      // As `enqueueDueDrafts`: one run per due item, at most three a day.
      const due = items.filter((i) => i.run_id === run.id && i.department === "post" && i.status === "planned" && i.day <= isoDay()).slice(0, 3);
      for (const item of due) enqueue("post_draft", { source: "schedule", loop: "daily-post-draft", item_id: item.id });
      return due.length;
    },
    async variantSource(_u, itemId) {
      const item = items.find((i) => i.id === itemId && i.department === "post" && (i.status === "in_review" || i.status === "approved"));
      return item && typeof item.body.text === "string" ? { text: item.body.text, platform: item.platform } : null;
    },
    async savePhotoCaption(_u, _run, postId, caption) {
      photoCaptions.set(postId, caption);
    },
    async saveVariant(_u, runId, itemId, platform, text, gen) {
      const at = variants.findIndex((v) => v.itemId === itemId && v.platform === platform);
      const row = { runId, itemId, platform, text, gen };
      if (at >= 0) variants[at] = row;
      else variants.push(row);
    },
    async saveDraft(_u, runId, itemId, idea, body, priority) {
      let item = itemId ? items.find((i) => i.id === itemId) : undefined;
      if (!item) {
        item = { id: id(), run_id: runId, department: "post", platform: "x", day: isoDay(), idea, reason: "", status: "planned", priority, body: {}, final_text: null, external_url: null, decided_at: null, published_at: null, created_at: new Date().toISOString() };
        items.push(item);
      }
      // As `cmo_save_draft`: the draft keeps the planner's targets and slot, so the post still goes to every platform.
      const kept = Object.fromEntries(Object.entries(item.body).filter(([k]) => k === "targets" || k === "slot"));
      Object.assign(item, { status: "in_review", body: { ...body, ...kept }, priority, run_id: runId });
      return item;
    },
    seenUrls: async () => new Set(opps.map((o) => o.url)),
    subredditRule: async (name) => rules.get(name.toLowerCase()) ?? null,
    async saveSubredditRule(rule) {
      rules.set(rule.subreddit.toLowerCase(), { ...rule, subreddit: rule.subreddit.toLowerCase(), read_at: new Date().toISOString() });
    },
    salesSettings: async () => salesSettings,
    recentMentions: async () => mentions.used,
    // Saved threads here are never decided, so every mention draft still waits.
    waitingMentions: async () => opps.filter((o) => o.rule === "safe" || o.rule === "requires_disclosure").length,
    async saveOpportunities(_u, _r, list) {
      const fresh = list.filter((o) => !opps.some((x) => x.url === o.url));
      opps.push(...fresh);
      return fresh.length;
    },
    async defer(run, seconds, steps) {
      const r = runs.find((x) => x.id === run.id)!;
      if (r.attempt !== run.attempt || r.status !== "running") return false;
      Object.assign(r, { status: "queued", attempt: Math.max(0, r.attempt - 1), notBefore: Date.now() + seconds * 1000, steps: steps.map((s) => ({ ...s })) });
      return true;
    },
    async saveInsight(_u, _run, body) {
      insights.push(body);
    },
    latestInsight: async () => insights.at(-1) ?? null,
    async saveNicheInsight(_u, _run, body) {
      niche.push(body);
    },
    latestNicheInsight: async () => niche.at(-1) ?? null,
    async saveMetrics(_u, rows) {
      const ok = rows.filter(
        (row) =>
          (row.source === "zernio" && zernio.posts.some((p) => p.item_id === row.item_id)) ||
          (row.source !== "zernio" && items.some((i) => i.id === row.item_id && i.status === "published")),
      );
      metrics.push(...ok);
      return ok.length;
    },
    zernioPosts: async (_u, since) => zernio.posts.filter((p) => p.published_at >= since),
    connectedAccounts: async () => ({ zernioProfileId: zernio.profileId, accounts: zernio.profileId ? zernio.accounts : [] }),
    async saveAccountMetrics(_u, rows) {
      const ok = rows.filter((r) => zernio.accounts.some((a) => a.id === r.social_account_id));
      for (const r of ok) {
        const i = zernio.days.findIndex((d) => d.social_account_id === r.social_account_id && d.day === r.day);
        if (i >= 0) zernio.days[i] = r;
        else zernio.days.push(r);
      }
      return ok.length;
    },
    refreshBestSlots: async () => 0,
    replyOutcomesDue: async (_u, limit) => replies.filter((r) => !r.check).slice(0, limit),
    async saveReplyOutcome(_u, outcomeId, check) {
      const row = replies.find((r) => r.outcome_id === outcomeId && !r.check);
      if (!row) return false;
      row.check = check;
      return true;
    },
  };
  const enqueue = (kind: QueuedRun["kind"], input: Record<string, unknown> = {}) => {
    const run: RunState = { id: id(), user_id: "u1", kind, input, attempt: 0, status: "queued", steps: [], error: null, output: null };
    runs.push(run);
    return run;
  };
  return { store, posting, runs, items, opps, rules, salesSettings, mentions, insights, niche, metrics, zernio, replies, lessons, goals, results, enqueue, voice, videos, captions, variants, photoCaptions, ratings, ratingRules };
}
