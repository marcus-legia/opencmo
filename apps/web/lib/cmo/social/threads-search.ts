/**
 * Threads conversations for Sales (Sales finder A3). ScrapeCreators searches Threads users, not posts, so Google finds
 * public posts (`site:threads.com`, last month), then `/v1/threads/post` reads each one with its replies: on Threads the
 * need is often in the replies ("same here, what do you use?"), and they come in the same lookup.
 *
 * Outside text: it is cleaned of invisible characters here and wrapped as data by the scan's prompt (`threadBlock`).
 */
import { cleanUntrusted } from "../untrusted";
import type { WebResult } from "./research";
import { isoTime, num, scFakeAllowed, scGet, str, type ScBudget } from "./scrapecreators";
import type { ConversationThread } from "./conversations";
import { findPostsViaGoogle, postCandidates, type Candidate, type PostRead } from "./google-posts";

/** A post's own page, as `normalizeConversationUrl` keeps it; the same shape `opportunities_url_check` takes. */
export const THREADS_POST = /^https:\/\/www\.threads\.com\/@[A-Za-z0-9._]{1,30}\/post\/[A-Za-z0-9_-]{1,40}$/;
const TEXT_MAX = 2000;
const REPLIES = 5;

export type ThreadsPost = PostRead & { replies: { author: string; text: string }[] };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const clean = (s: string, max: number) => cleanUntrusted(s).replace(/[ \t]+/g, " ").trim().slice(0, max);

/** Google results that are Threads posts, once each (both domains and a slug collapse to one URL). */
export const threadsCandidates = (results: WebResult[]): Candidate[] => postCandidates(results, THREADS_POST);

/** One public post and its first replies (`/v1/threads/post`, cached a week). */
export async function readThreadsPost(url: string, budget?: ScBudget): Promise<ThreadsPost> {
  const json = obj(await scGet("/v1/threads/post", { url, cache_max_age: "7d" }, budget));
  const post = obj(json.post);
  const comments = Array.isArray(json.comments) ? json.comments : [];
  const replies = comments
    .map((c) => ({ author: clean(str(obj(obj(c).user).username), 40), text: clean(str(obj(obj(c).caption).text), 400) }))
    .filter((c) => c.text)
    .slice(0, REPLIES);
  return {
    text: clean(str(obj(post.caption).text), TEXT_MAX),
    author: clean(str(obj(post.user).username), 100),
    postedAt: isoTime(post.taken_at),
    // `scGet` asks for the trimmed answer, which has no reply count (2026-11-14 capture): the replies it carries count.
    comments: num(obj(post.text_post_app_info).direct_reply_count) || comments.length,
    replies,
  };
}

/**
 * Public Threads posts about `query` from the last month: one Google lookup, then up to `readPosts` reads (default 4)
 * of posts the founder has not seen (`skip`).
 */
export async function searchThreadsConversations(query: string, budget: ScBudget, opts: { readPosts?: number; skip?: (url: string) => boolean } = {}): Promise<ConversationThread[]> {
  if (scFakeAllowed()) return fakeThreads(query).filter((t) => !opts.skip?.(t.url));
  return findPostsViaGoogle({
    site: "threads.com",
    query,
    budget,
    pattern: THREADS_POST,
    readPosts: opts.readPosts,
    skip: opts.skip,
    read: readThreadsPost,
    toThread: (c, post) => {
      const body = post?.text || clean(`${c.title}\n${c.description}`, TEXT_MAX);
      if (!body) return null;
      const text = [body, ...(post?.replies ?? []).map((r) => `— ${r.author || "someone"}: ${r.text}`)].join("\n").slice(0, TEXT_MAX);
      return {
        platform: "threads",
        url: c.url,
        community: "Threads",
        title: clean(body.split("\n")[0]!, 120) || "Threads post",
        author: post?.author || (/\/@([^/]+)\//.exec(c.url)?.[1] ?? ""),
        text,
        comments: post?.comments ?? 0,
        postedAt: post?.postedAt ?? null,
      };
    },
  });
}

function fakeThreads(query: string): ConversationThread[] {
  return [1, 2].map((n) => ({
    platform: "threads" as const,
    url: `https://www.threads.com/@maker${n}/post/Fake${n}Post`,
    community: "Threads",
    title: `How do you all handle ${query}?`,
    author: `maker${n}`,
    text: `How do you all handle ${query}? Spent my whole Sunday on it again.\n— someone: same here, looking for a tool`,
    comments: 3 + n,
    postedAt: null,
  }));
}
