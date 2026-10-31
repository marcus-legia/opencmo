/**
 * Hacker News as a source for Sales and Research (P6 R4; `research-sales.md` §9).
 *
 * Algolia's public HN search (`hn.algolia.com/api/v1`): no key, a generous per-IP limit, so we still
 * count our own calls (`HnBudget`) to stay well inside it and to stop loops. Everything it returns is
 * outside text: cleaned of smuggled Unicode here and wrapped as data by the caller.
 *
 * Not `server-only` so checks can run it.
 */

/** One HN story, shaped like `RedditThread` so Sales can score both the same way. */
export type HnThread = {
  /** Always the discussion page `https://news.ycombinator.com/item?id=<id>`, never the linked site. */
  url: string;
  objectId: string;
  /** Shown where a subreddit would be. */
  community: "Hacker News";
  title: string;
  author: string;
  /** The story text (Ask HN / Show HN), or empty for a link post. */
  text: string;
  points: number;
  comments: number;
  postedAt: string | null;
};

export class HnReadError extends Error {}

/** Calls per request (a chat turn or a scan). Algolia allows far more; this is our own brake. */
export class HnBudget {
  used = 0;
  constructor(readonly limit: number) {}
  take(): void {
    if (this.used + 1 > this.limit) {
      throw new HnReadError(`Hacker News limit reached for this request (${this.limit} searches). Summarize what you found.`);
    }
    this.used += 1;
  }
}

/** The seam Sales and Research call; tests and evals pass recorded responses through it. */
export type HnSource = {
  search(query: string, budget: HnBudget): Promise<HnThread[]>;
};
