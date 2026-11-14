/**
 * Posts found through Google and read one by one (Sales finder A3): the way Sales reaches platforms ScrapeCreators
 * cannot search (Facebook groups, Threads). One Google lookup; the posts it links are kept only when they are a post's
 * own page, once each, and not already seen by the founder; the first few are read in parallel; a post that cannot be
 * read keeps Google's words.
 */
import { googleSearch, type WebResult } from "./research";
import { SocialReadError, type ScBudget } from "./scrapecreators";
import { normalizeConversationUrl, type ConversationThread } from "./conversations";

const MAX_AGE_MS = 30 * 86_400_000;

export type PostRead = { text: string; author: string; postedAt: string | null; comments: number };
export type Candidate = WebResult & { url: string };

/** Google results that are a post's own page (`pattern` on the stored form), once each, in Google's order. */
export function postCandidates(results: WebResult[], pattern: RegExp): Candidate[] {
  const seen = new Set<string>();
  return results.flatMap((r) => {
    const url = normalizeConversationUrl(r.url);
    if (!url || !pattern.test(url) || seen.has(url)) return [];
    seen.add(url);
    return [{ ...r, url }];
  });
}

/**
 * A read error that must stop the step rather than fall back to Google's words: no key, no lookup credits, the
 * founder's daily cap. Trying the next post would fail the same way (or spend past the cap).
 */
const fatal = (error: unknown) => !(error instanceof SocialReadError) || error.kind === "setup" || error.kind === "credits" || error.kind === "cap";

export async function findPostsViaGoogle<P extends PostRead>(opts: {
  /** `site:` filter, e.g. `facebook.com/groups`. */
  site: string;
  query: string;
  budget: ScBudget;
  pattern: RegExp;
  /** Posts read in full (default 4); the rest keep Google's title and description. */
  readPosts?: number;
  /** Posts the founder has already seen: never read, never returned. */
  skip?: (url: string) => boolean;
  read: (url: string, budget: ScBudget) => Promise<P>;
  toThread: (candidate: Candidate, post: P | null) => ConversationThread | null;
}): Promise<ConversationThread[]> {
  const results = await googleSearch(`site:${opts.site} ${opts.query}`, opts.budget, { datePosted: "last-month" });
  const candidates = postCandidates(results, opts.pattern).filter((c) => !opts.skip?.(c.url));
  const readPosts = Math.max(0, opts.readPosts ?? 4);
  // Independent reads, each up to the lookup timeout: in parallel, so one slow post does not hold the others.
  const reads = await Promise.allSettled(candidates.slice(0, readPosts).map((c) => opts.read(c.url, opts.budget)));
  const stop = reads.find((r): r is PromiseRejectedResult => r.status === "rejected" && fatal(r.reason));
  if (stop) throw stop.reason;
  const now = Date.now();
  return candidates.flatMap((c, i) => {
    const read = reads[i];
    const post = read?.status === "fulfilled" ? read.value : null;
    if (post?.postedAt && now - Date.parse(post.postedAt) > MAX_AGE_MS) return [];
    const thread = opts.toThread(c, post);
    return thread ? [thread] : [];
  });
}
