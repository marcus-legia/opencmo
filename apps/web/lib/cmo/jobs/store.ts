import "server-only";

import type { SupabaseClient as BaseClient } from "@supabase/supabase-js";

import { DOCUMENT_KINDS, type DocumentKind } from "../documents";
import { latestPerTopic } from "./context";
import type { CmoStore, DraftRating, CompetitorInsight, ConnectedAccountRow, ReplyOutcomeDue, ZernioPostRow, Documents, NicheVideoInsight, SubredditRule, Goal, InboxState, ItemRow, Lesson, MemoryEvent, QueuedRun } from "./types";
import { isoDay, toVerdict } from "./types";
import { enqueueDueDrafts } from "../schedule";
import { planOrDefault } from "../posting-plan";

const ITEM_COLUMNS =
  "id, run_id, department, platform, day, idea, reason, status, priority, body, final_text, external_url, decided_at, published_at, created_at";

function one<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" && (row as { id?: unknown }).id ? (row as T) : null;
}

/** The real store: a service-role client calling service-only RPCs with an explicit user id (like the Python worker). */
export function supabaseStore(admin: BaseClient): CmoStore {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  }
  return {
    spendClient: admin as unknown as NonNullable<CmoStore["spendClient"]>,
    async claim(runId) {
      const row = one<QueuedRun>(await rpc("claim_cmo_run", { p_run_id: runId ?? null, p_lease_seconds: 300 }));
      return row;
    },
    step: (run, steps) => rpc<boolean>("cmo_run_step", { p_run: run.id, p_attempt: run.attempt, p_steps: steps }),
    complete: (run, ok, output, error) =>
      rpc<boolean>("complete_cmo_run", { p_run: run.id, p_attempt: run.attempt, p_ok: ok, p_output: output, p_error: error }),
    async documents(userId) {
      const { data, error } = await admin.from("marketing_documents_latest").select("kind, body").eq("user_id", userId);
      if (error) throw new Error(`documents: ${error.message}`);
      const out: Documents = {};
      for (const row of (data ?? []) as { kind: DocumentKind; body: Record<string, unknown> }[]) {
        if (DOCUMENT_KINDS.includes(row.kind)) out[row.kind] = row.body;
      }
      return out;
    },
    async memories(userId, limit, topic, opts) {
      let query = admin
        .from("cmo_memories")
        .select("body")
        .eq("user_id", userId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
      if (topic) query = query.in("topic", topic === "general" ? ["general"] : [topic, "general"]);
      if (opts?.voice === false) query = query.is("source_outcome", null);
      const { data, error } = await query.order("importance", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
      if (error) throw new Error(`store read: ${error.message}`);
      return ((data ?? []) as { body: string }[]).map((m) => m.body);
    },
    async memoryEvents(userId, since) {
      const { data, error } = await admin
        .from("cmo_memories")
        .select("kind, topic, body, created_at")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(`memoryEvents: ${error.message}`);
      return (data ?? []) as MemoryEvent[];
    },
    async voiceNotes(userId, limit) {
      const { data, error } = await admin.rpc("voice_notes_for", { p_user: userId, p_limit: limit, p_platform: null });
      if (error) throw new Error(`voice_notes_for: ${error.message}`);
      return ((data ?? []) as { body: string; platform: string | null; created_at: string; weight: number; source: string }[]).map((n) => ({ body: n.body, platform: n.platform, created_at: n.created_at, weight: Number(n.weight), source: n.source }));
    },
    // The editor's code loads only for a caption run.
    videoSource: async (userId, clipId) => (await import("../writer/video-source")).readVideoSource(userId, clipId),
    async saveCaption(userId, runId, clipId, profile, text, title, gen) {
      await rpc("cmo_save_caption", { p_user: userId, p_run: runId, p_clip: clipId, p_profile: profile, p_text: text, p_title: title, p_gen: gen });
    },
    async ratingRound(userId, round) {
      const { data, error } = await admin.rpc("cmo_rating_round", { p_user: userId, p_round: round });
      if (error) throw new Error(`cmo_rating_round: ${error.message}`);
      return (data ?? []) as DraftRating[];
    },
    async proposeRatingRules(userId, round, rules) {
      const { data, error } = await admin.rpc("cmo_propose_rating_rules", { p_user: userId, p_round: round, p_rules: rules });
      if (error) throw new Error(`cmo_propose_rating_rules: ${error.message}`);
      return Number(data ?? 0);
    },
    async corrections(userId) {
      const { data, error } = await admin
        .from("cmo_corrections")
        .select("rule")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(`corrections: ${error.message}`);
      return ((data ?? []) as { rule: string }[]).map((c) => c.rule);
    },
    async lessons(userId) {
      const { data, error } = await admin.from("cmo_lessons").select("week, topic, body").eq("user_id", userId).order("week", { ascending: false }).limit(20);
      if (error) throw new Error(`store read: ${error.message}`);
      return latestPerTopic((data ?? []) as Lesson[]);
    },
    saveLessons: (userId, runId, week, lessons) => rpc<number>("cmo_save_lessons", { p_user: userId, p_run: runId, p_week: week, p_lessons: lessons }),
    async goal(userId, week) {
      const { data, error } = await admin
        .from("cmo_goals")
        .select("id, week, goal, metric, target, status, result")
        .eq("user_id", userId)
        .eq("week", week)
        .maybeSingle();
      if (error) throw new Error(`cmo_goals: ${error.message}`);
      return (data as Goal | null) ?? null;
    },
    async weekResults(userId, since) {
      const count = async (table: string, status: string[], extra?: { column: string; value: string }) => {
        let query = admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", status).gte("decided_at", since);
        if (extra) query = query.eq(extra.column, extra.value);
        const { count: n, error } = await query;
        // A failed count is not 0: review_week would store "not met" on the founder's goal.
        if (error) throw new Error(`${table}: ${error.message}`);
        return n ?? 0;
      };
      // Views count only posts published this week (owner, 2026-11-02): a post measured this week but published
      // earlier would add its lifetime views to every week it is measured in.
      const [posts, replies, { data: measured, error: measuredError }] = await Promise.all([
        count("content_items", ["approved", "published"], { column: "department", value: "post" }),
        count("opportunities", ["replied"]),
        admin
          .from("post_metrics")
          .select("item_id, views, content_items!inner(published_at)")
          .eq("user_id", userId)
          .gte("measured_at", since)
          .gte("content_items.published_at", since)
          .limit(1000),
      ]);
      if (measuredError) throw new Error(`post_metrics: ${measuredError.message}`);
      // Several measurements per post: keep the highest per post, then add them up.
      const best = new Map<string, number>();
      for (const row of (measured ?? []) as { item_id: string; views: number | null }[]) best.set(row.item_id, Math.max(best.get(row.item_id) ?? 0, Number(row.views)));
      return { posts, replies, views: [...best.values()].reduce((a, b) => a + b, 0) };
    },
    async proposeGoal(userId, runId, week, goal) {
      const { data, error } = await admin.rpc("cmo_propose_goal", {
        p_user: userId,
        p_run: runId,
        p_week: week,
        p_goal: goal.goal,
        p_metric: goal.metric,
        p_target: goal.target,
      });
      // The founder already approved that week's goal: their choice stands.
      if (error?.code === "P0001") return null;
      if (error) throw new Error(`cmo_propose_goal: ${error.message}`);
      return one<Goal>(data);
    },
    recordGoalResult: (userId, week, result) => rpc<boolean>("cmo_record_goal_result", { p_user: userId, p_week: week, p_result: result }),
    async items(userId, filter) {
      let query = admin.from("content_items").select(ITEM_COLUMNS).eq("user_id", userId);
      if (filter.statuses) query = query.in("status", filter.statuses);
      if (filter.department) query = query.eq("department", filter.department);
      if (filter.since) query = query.gte("created_at", filter.since);
      // The newest rows under the limit, handed back oldest first: ascending before the limit kept the OLDEST 50, so
      // pull_metrics stopped measuring after 50 posts and draft_post's "recent posts" were months old.
      const { data, error } = await query.order("day", { ascending: false }).order("created_at", { ascending: false }).limit(filter.limit ?? 50);
      if (error) throw new Error(`items: ${error.message}`);
      return ((data ?? []) as ItemRow[]).reverse();
    },
    planWeek: (userId, runId, items) => rpc<number>("cmo_plan_week", { p_user: userId, p_run: runId, p_items: items }),
    async postingPlan(userId) {
      const [profile, accounts] = await Promise.all([
        admin.from("profiles").select("posting_plan").eq("id", userId).maybeSingle(),
        admin.from("social_accounts").select("platform").eq("user_id", userId).eq("status", "connected"),
      ]);
      if (profile.error) throw new Error(`profiles: ${profile.error.message}`);
      if (accounts.error) throw new Error(`social_accounts: ${accounts.error.message}`);
      return planOrDefault((profile.data as { posting_plan: unknown } | null)?.posting_plan, ((accounts.data ?? []) as { platform: string }[]).map((a) => a.platform));
    },
    async queueDueDrafts(run) {
      const { data, error } = await admin.from("content_items").select("id, platform").eq("user_id", run.user_id).eq("run_id", run.id)
        .eq("department", "post").eq("status", "planned").lte("day", isoDay()).order("day").order("id");
      if (error) throw new Error(`queueDueDrafts: ${error.message}`);
      const [queued] = await enqueueDueDrafts(admin, run.user_id, (data ?? []) as { id: string; platform: string | null }[], { claude: run.input.brain === "claude" });
      return queued;
    },
    async variantSource(userId, itemId) {
      const { data, error } = await admin
        .from("content_items")
        .select("platform, body")
        .eq("id", itemId)
        .eq("user_id", userId)
        .eq("department", "post")
        .in("status", ["in_review", "approved"])
        .maybeSingle<{ platform: string; body: { text?: unknown } | null }>();
      if (error) throw new Error(`variant source: ${error.message}`);
      return data && typeof data.body?.text === "string" ? { text: data.body.text, platform: data.platform } : null;
    },
    async saveVariant(userId, runId, itemId, platform, text, gen) {
      await rpc("cmo_save_variant", { p_user: userId, p_run: runId, p_item: itemId, p_platform: platform, p_text: text, p_gen: gen });
    },
    async savePhotoCaption(userId, runId, postId, caption) {
      await rpc("cmo_save_photo_caption", { p_user: userId, p_run: runId, p_id: postId, p_caption: caption });
    },
    async saveDraft(userId, runId, itemId, idea, body, priority) {
      const row = one<ItemRow>(
        await rpc("cmo_save_draft", { p_user: userId, p_run: runId, p_item: itemId, p_idea: idea, p_body: body, p_priority: priority }),
      );
      if (!row) throw new Error("cmo_save_draft: returned no row");
      return row;
    },
    async seenUrls(userId) {
      const { data, error } = await admin.from("opportunities").select("url").eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
      // An empty set after a failed read would re-score and re-draft threads that are already cards.
      if (error) throw new Error(`opportunities: ${error.message}`);
      return new Set(((data ?? []) as { url: string }[]).map((r) => r.url));
    },
    saveOpportunities: (userId, runId, items) => rpc<number>("cmo_save_opportunities", { p_user: userId, p_run: runId, p_items: items }),
    async subredditRule(subreddit) {
      const { data, error } = await admin
        .from("subreddit_rules")
        .select("subreddit, verdict, summary, read_at, min_karma, min_account_age_days, megathread")
        .eq("subreddit", subreddit.toLowerCase())
        .maybeSingle();
      if (error) throw new Error(`subreddit_rules: ${error.message}`);
      // Rows written before 5.1 carry the old values.
      return data ? { ...(data as SubredditRule), verdict: toVerdict((data as { verdict: unknown }).verdict) } : null;
    },
    async saveSubredditRule(rule) {
      const { error } = await admin
        .from("subreddit_rules")
        .upsert({
          subreddit: rule.subreddit.toLowerCase(),
          verdict: rule.verdict,
          summary: rule.summary.slice(0, 200),
          min_karma: rule.min_karma ?? null,
          min_account_age_days: rule.min_account_age_days ?? null,
          megathread: rule.megathread ?? false,
          read_at: new Date().toISOString(),
        });
      if (error) throw new Error(`subreddit_rules: ${error.message}`);
    },
    async salesSettings(userId) {
      const { data, error } = await admin.from("sales_settings").select("excluded_subreddits, co_occurrence").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`sales_settings: ${error.message}`);
      const row = data as { excluded_subreddits: string[]; co_occurrence: [string, string][] } | null;
      return { excluded: row?.excluded_subreddits ?? [], pairs: row?.co_occurrence ?? [] };
    },
    recentMentions: (userId) => rpc<number>("sales_mention_count_for", { p_user: userId }),
    async waitingMentions(userId) {
      const { count, error } = await admin.from("opportunities").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "in_review").in("rule", ["safe", "requires_disclosure", "mention_ok"]);
      if (error) throw new Error(`opportunities: ${error.message}`);
      return count ?? 0;
    },
    defer: (run, seconds, steps) => rpc<boolean>("cmo_defer_run", { p_run: run.id, p_attempt: run.attempt, p_seconds: seconds, p_steps: steps }),
    async saveInsight(userId, runId, body) {
      await rpc("cmo_save_insight", { p_user: userId, p_run: runId, p_kind: "competitors", p_body: body });
    },
    async latestInsight(userId) {
      const { data, error } = await admin.from("cmo_insights").select("body").eq("user_id", userId).eq("kind", "competitors").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(`store read: ${error.message}`);
      return ((data as { body?: CompetitorInsight } | null)?.body ?? null);
    },
    async saveNicheInsight(userId, runId, body) {
      await rpc("cmo_save_insight", { p_user: userId, p_run: runId, p_kind: "niche_video", p_body: body });
    },
    async latestNicheInsight(userId) {
      const { data, error } = await admin.from("cmo_insights").select("body").eq("user_id", userId).eq("kind", "niche_video").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(`store read: ${error.message}`);
      return ((data as { body?: NicheVideoInsight } | null)?.body ?? null);
    },
    saveMetrics: (userId, rows) => rpc<number>("cmo_save_metrics", { p_user: userId, p_rows: rows }),
    zernioPosts: (userId, since) => rpc<ZernioPostRow[]>("cmo_zernio_posts", { p_user: userId, p_since: since }).then((rows) => rows ?? []),
    async connectedAccounts(userId) {
      const [profile, accounts] = await Promise.all([
        admin.from("zernio_profiles").select("zernio_profile_id").eq("user_id", userId).maybeSingle(),
        admin.from("social_accounts").select("id, platform, handle, zernio_account_id").eq("user_id", userId).eq("status", "connected"),
      ]);
      if (profile.error) throw new Error(`zernio_profiles: ${profile.error.message}`);
      if (accounts.error) throw new Error(`social_accounts: ${accounts.error.message}`);
      const id = (profile.data as { zernio_profile_id?: string } | null)?.zernio_profile_id ?? null;
      return { zernioProfileId: id, accounts: id ? ((accounts.data ?? []) as ConnectedAccountRow[]) : [] };
    },
    saveAccountMetrics: (userId, rows) => rpc<number>("cmo_save_account_metrics", { p_user: userId, p_rows: rows }),
    refreshBestSlots: (userId) => rpc<number>("best_slots_refresh", { p_user: userId }),
    replyOutcomesDue: (userId, limit) => rpc<ReplyOutcomeDue[]>("cmo_reply_outcomes_due", { p_user: userId, p_limit: limit }).then((rows) => rows ?? []),
    saveReplyOutcome: (userId, outcomeId, c) =>
      rpc<boolean>("cmo_save_reply_outcome", { p_user: userId, p_outcome: outcomeId, p_status: c.status, p_votes: c.votes, p_replies: c.replies }),
    async inbox(userId, inboxId) {
      const { data, error } = await admin.from("cmo_inbox").select("answers, memo").eq("id", inboxId).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`inbox: ${error.message}`);
      return (data as InboxState | null) ?? null;
    },
    async openInbox(run, step, request, memo) {
      return one<{ id: string }>(
        await rpc("cmo_inbox_open", { p_run: run.id, p_attempt: run.attempt, p_step: step, p_request: request, p_memo: memo }),
      )?.id ?? null;
    },
    async finishInbox(run, ok, feedback) {
      await rpc("cmo_inbox_finish", { p_run: run.id, p_ok: ok, p_feedback: feedback });
    },
  };
}
