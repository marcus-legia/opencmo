/**
 * What the founder's replies got (P6 A3, R3; `research-sales.md` §6). Three days after "replied", the thread is read
 * again: Reddit through the social reader, Hacker News through Algolia (free), and Threads through the social reader
 * (wave 3 B6). The founder's reply is found by its text; the link they pasted ("I replied", `reply_url`) narrows a
 * Hacker News read to that comment and is the only way into a Threads reply's own answers. Its votes and replies are
 * stored on the outcome, and a reply someone answered is `answeredBack` (SQL moves the person to "answered back").
 * Facebook groups have no reader that lists a post's comments, so the founder marks those. SQL writes the memory line
 * from our own numbers; nothing the thread says reaches memory or a prompt.
 */

import { HnBudget, HnReadError, hnItem, type HnComment } from "../social/hn";
import { redditThread } from "../social/research";
import { readThreadsPost, THREADS_POST } from "../social/threads-search";
import { ScBudget, SocialReadError, socialReaderReady, type RedditComment } from "../social/scrapecreators";
import type { JobContext } from "./runner";
import { safeForSales } from "../sales/ban-risk";
import { voiceBlock } from "../writer/context";
import { draftMessages, type DmTarget } from "./sales-scan";
import type { NudgeDue, ReplyOutcomeDue } from "./types";

/** Nudges drafted a run: one model call, a few people. */
export const MAX_NUDGES = 10;

/** At most this many replies checked a run: each Reddit read costs a lookup. */
export const MAX_REPLY_CHECKS = 10;
/** Enough comments to find a reply that is not near the top. */
const REDDIT_COMMENTS = 100;

// Letters and digits of every script: a reply written in Russian or Japanese has words too.
const words = (s: string) => s.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter((w) => [...w].length > 2 || /[^\p{Script=Latin}\p{N}]/u.test(w));

/** How much of the founder's reply a comment holds (0–1): the share of the reply's words found in it. */
export function replyOverlap(reply: string, comment: string): number {
  const mine = [...new Set(words(reply))];
  if (!mine.length) return 0;
  const theirs = new Set(words(comment));
  return mine.filter((w) => theirs.has(w)).length / mine.length;
}

/** The comment that is the founder's reply: most of its words, edits allowed (the founder posts by hand). */
export function findReply<C extends { text: string }>(reply: string, comments: C[]): C | null {
  let best: { c: C; score: number } | null = null;
  for (const c of comments) {
    const score = replyOverlap(reply, c.text);
    if (score >= 0.7 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

export type ReplyReaders = {
  reddit: (url: string) => Promise<{ gone: boolean; comments: RedditComment[] }>;
  hn: (url: string) => Promise<HnComment[] | null>;
  /** A Threads post's first replies (`readThreadsPost`); unset leaves Threads replies to the founder. */
  threads?: (url: string) => Promise<{ author: string; text: string }[]>;
};

export function defaultReaders(): ReplyReaders {
  const sc = new ScBudget(MAX_REPLY_CHECKS);
  const hn = new HnBudget(MAX_REPLY_CHECKS);
  return {
    reddit: async (url) => {
      const read = await redditThread(url, sc, REDDIT_COMMENTS);
      return { gone: !read.post, comments: read.comments };
    },
    hn: (url) => hnItem(url, hn),
    threads: async (url) => (await readThreadsPost(url, sc)).replies,
  };
}

export type ReplyCheck = {
  status: "found" | "not_found" | "gone";
  votes: number | null;
  replies: number | null;
  /** Someone answered the founder's reply: the person moves to "answered back" (wave 3 B6). */
  answeredBack?: boolean;
};

/** A found reply with answers under it is an answer back; a count we could not read is not. */
const withAnswer = (check: ReplyCheck): ReplyCheck => ({ ...check, answeredBack: check.status === "found" && (check.replies ?? 0) > 0 });

/** Reads one reply's thread; a read that fails (reader down, limit hit) is null, so it is tried again tomorrow. */
export async function checkReply(due: ReplyOutcomeDue, readers: ReplyReaders): Promise<ReplyCheck | null> {
  try {
    if (due.platform === "hn") {
      // A pasted link to the reply itself is read alone; otherwise the whole discussion.
      const comments = await readers.hn(due.outcome_url ?? due.url);
      if (!comments) return { status: "gone", votes: null, replies: null };
      const mine = findReply(due.reply, comments);
      return withAnswer(mine ? { status: "found", votes: null, replies: mine.replies } : { status: "not_found", votes: null, replies: null });
    }
    if (due.platform === "threads") {
      if (!readers.threads) return null;
      // On Threads a reply is a post of its own: its link reads the answers under it. Without the link, the post's
      // first replies say only whether the founder's reply is there.
      if (due.outcome_url && THREADS_POST.test(due.outcome_url)) {
        const answers = await readers.threads(due.outcome_url);
        return withAnswer({ status: "found", votes: null, replies: answers.length });
      }
      const replies = await readers.threads(due.url);
      return findReply(due.reply, replies) ? { status: "found", votes: null, replies: null, answeredBack: false } : { status: "not_found", votes: null, replies: null };
    }
    if (due.platform !== "reddit") return null;
    const read = await readers.reddit(due.url);
    if (read.gone) return { status: "gone", votes: null, replies: null };
    const mine = findReply(due.reply, read.comments);
    return withAnswer(mine ? { status: "found", votes: mine.score, replies: mine.replies ?? null } : { status: "not_found", votes: null, replies: null });
  } catch (error) {
    // A removed or deleted Reddit thread is gone for good: reading it again every day would cost a lookup each time.
    if (error instanceof SocialReadError && error.kind === "not_found") return { status: "gone", votes: null, replies: null };
    if (error instanceof SocialReadError || error instanceof HnReadError) return null;
    throw error;
  }
}

/** The `pull_metrics` step: every reply due, checked once. Reddit replies wait while the reader is not set up. */
export async function checkReplies(ctx: JobContext, readers: ReplyReaders = defaultReaders()): Promise<{ checked: number; found: number; answered?: number }> {
  const { store, run } = ctx;
  // Facebook groups have no reader that lists a post's comments: their outcomes stay unchecked (the founder marks
  // them) instead of being read as another platform and marked gone. Reddit and Threads wait for the social reader.
  const due = (await store.replyOutcomesDue(run.user_id, MAX_REPLY_CHECKS)).filter(
    (d) => d.platform === "hn" || ((d.platform === "reddit" || d.platform === "threads") && socialReaderReady()),
  );
  if (!due.length) return { checked: 0, found: 0 };
  return ctx.step(
    "check_replies",
    "Checking what your replies got",
    async () => {
      let checked = 0;
      let found = 0;
      let answered = 0;
      for (const d of due) {
        const result = await checkReply(d, readers);
        if (!result) continue;
        if (await store.saveReplyOutcome(run.user_id, d.outcome_id, result)) {
          checked += 1;
          if (result.status === "found") found += 1;
          // SQL moves the person from replied to answered back, never backwards.
          if (result.answeredBack && (await store.markAnsweredBack(run.user_id, d.opportunity_id))) answered += 1;
        }
      }
      return { checked, found, answered };
    },
    (r) => `${r.checked} replies checked, ${r.found} found${r.answered ? `, ${r.answered} answered back` : ""}`,
  );
}

/**
 * Wave 3 B2: one follow-up for each person the founder replied to four or more days ago who has not answered and has
 * no nudge yet (`cmo_nudges_due`). Runs after the re-reads, so an answer found today stops the nudge. Drafted with the
 * nudge prompt and its checks (`draftMessages`), saved on the person (`cmo_save_nudge`); the founder sends it or not.
 */
export async function draftNudges(ctx: JobContext): Promise<{ drafted: number }> {
  const { store, run } = ctx;
  const due = (await store.nudgesDue(run.user_id, MAX_NUDGES)).filter((d): d is NudgeDue & { reply: string } => typeof d.reply === "string" && d.reply.trim().length > 0);
  if (!due.length) return { drafted: 0 };
  return ctx.step(
    "draft_nudge",
    `Drafting ${due.length === 1 ? "a follow-up" : `${due.length} follow-ups`} for replies with no answer`,
    async () => {
      const docs = await store.documents(run.user_id);
      const voice = voiceBlock(
        (await store.voiceNotes(run.user_id, 5))
          .filter((n) => safeForSales(n.body))
          .map((n) => ({ body: n.body, platform: n.platform, weight: n.weight, createdAt: n.created_at })),
      );
      const targets: DmTarget[] = due.map((d) => ({
        thread: { platform: d.platform, url: d.url, community: d.community, title: d.title, author: "", text: d.snippet, comments: 0, postedAt: d.posted_at },
        reply: d.reply,
      }));
      const { textFor } = await draftMessages(ctx, "nudge", { docs, voice, targets });
      let drafted = 0;
      for (const [index, text] of textFor) {
        if (await store.saveNudge(run.user_id, run.id, due[index]!.opportunity_id, text)) drafted += 1;
      }
      return { drafted };
    },
    (r) => `${r.drafted} ${r.drafted === 1 ? "follow-up" : "follow-ups"} drafted`,
  );
}
