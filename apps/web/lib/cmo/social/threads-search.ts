/**
 * Threads conversations for Sales (Sales finder A3). ScrapeCreators searches Threads users, not posts, so Google finds
 * public posts (`site:threads.com`, last month), then `/v1/threads/post` reads each one with its replies: on Threads the
 * need is often in the replies ("same here, what do you use?"), and they come in the same lookup.
 *
 * Outside text: it is cleaned of invisible characters here and wrapped as data by the scan's prompt (`threadBlock`).
 */
import { cleanUntrusted } from "../untrusted";
import { googleSearch, type WebResult } from "./research";
import { isoTime, num, scFakeAllowed, scGet, SocialReadError, str, type ScBudget } from "./scrapecreators";
import { normalizeConversationUrl, type ConversationThread } from "./conversations";

/** A post's own page, as `normalizeConversationUrl` keeps it; the same shape `opportunities_url_check` takes. */
export const THREADS_POST = /^https:\/\/www\.threads\.com\/@[A-Za-z0-9._]{1,30}\/post\/[A-Za-z0-9_-]{1,40}$/;
const MAX_AGE_MS = 30 * 86_400_000;
const TEXT_MAX = 2000;
const REPLIES = 5;

export type ThreadsPost = { text: string; author: string; postedAt: string | null; comments: number; replies: { author: string; text: string }[] };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const clean = (s: string, max: number) => cleanUntrusted(s).replace(/[ \t]+/g, " ").trim().slice(0, max);

/** Google results that are Threads posts, once each (both domains collapse to one URL). A profile is not a post. */
export function threadsCandidates(results: WebResult[]): (WebResult & { url: string })[] {
  const seen = new Set<string>();
  return results.flatMap((r) => {
    const url = normalizeConversationUrl(r.url);
    if (!url || !THREADS_POST.test(url) || seen.has(url)) return [];
    seen.add(url);
    return [{ ...r, url }];
  });
}

/** One public post and its first replies (`/v1/threads/post`, cached a week). */
export async function readThreadsPost(url: string, budget?: ScBudget): Promise<ThreadsPost> {
  const json = obj(await scGet("/v1/threads/post", { url, cache_max_age: "7d" }, budget));
  const post = obj(json.post);
  const replies = (Array.isArray(json.comments) ? json.comments : [])
    .map((c) => ({ author: clean(str(obj(obj(c).user).username), 40), text: clean(str(obj(obj(c).caption).text), 400) }))
    .filter((c) => c.text)
    .slice(0, REPLIES);
  return {
    text: clean(str(obj(post.caption).text), TEXT_MAX),
    author: clean(str(obj(post.user).username), 100),
    postedAt: isoTime(post.taken_at),
    comments: num(obj(post.text_post_app_info).direct_reply_count),
    replies,
  };
}

/**
 * Public Threads posts about `query` from the last month. One Google lookup, then up to `readPosts` post reads
 * (default 4). A post that cannot be read keeps Google's title and description as its text.
 */
export async function searchThreadsConversations(query: string, budget: ScBudget, opts: { readPosts?: number } = {}): Promise<ConversationThread[]> {
  if (scFakeAllowed()) return fakeThreads(query);
  const candidates = threadsCandidates(await googleSearch(`site:threads.com ${query}`, budget, { datePosted: "last-month" }));
  const readPosts = Math.max(0, opts.readPosts ?? 4);
  const out: ConversationThread[] = [];
  for (const [i, c] of candidates.entries()) {
    let post: ThreadsPost | null = null;
    if (i < readPosts) {
      try {
        post = await readThreadsPost(c.url, budget);
      } catch (error) {
        if (!(error instanceof SocialReadError) || error.kind === "setup") throw error;
      }
    }
    if (post?.postedAt && Date.now() - Date.parse(post.postedAt) > MAX_AGE_MS) continue;
    const body = post?.text || clean(`${c.title}\n${c.description}`, TEXT_MAX);
    if (!body) continue;
    const text = [body, ...(post?.replies ?? []).map((r) => `— ${r.author || "someone"}: ${r.text}`)].join("\n").slice(0, TEXT_MAX);
    out.push({
      platform: "threads",
      url: c.url,
      community: "Threads",
      title: clean(body.split("\n")[0]!, 120) || "Threads post",
      author: post?.author || (/\/@([^/]+)\//.exec(c.url)?.[1] ?? ""),
      text,
      comments: post?.comments ?? 0,
      postedAt: post?.postedAt ?? null,
    });
  }
  return out;
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
