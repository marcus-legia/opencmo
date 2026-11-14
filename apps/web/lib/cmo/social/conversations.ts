/**
 * One conversation, whatever platform it is on (Sales finder v1, docs/plans/cmo/2026-11-14-sales-finder-plan.md). The
 * scan, the chat and the Sales screen share this list and this shape, so a platform is added in one place. Pure: the
 * browser imports it too.
 */

export const SALES_PLATFORMS = ["reddit", "hn", "facebook", "threads"] as const;
export type SalesPlatform = (typeof SALES_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<SalesPlatform, string> = {
  reddit: "Reddit",
  hn: "Hacker News",
  facebook: "Facebook groups",
  threads: "Threads",
};

/** One conversation from any platform, in the shape the scan scores (a Reddit thread plus its platform). */
export type ConversationThread = {
  platform: SalesPlatform;
  url: string;
  community: string;
  title: string;
  author: string;
  text: string;
  comments: number;
  postedAt: string | null;
};

/** Hosts a stored conversation may point at, and the one spelling each is kept under. */
const HOSTS: Record<string, string> = {
  "reddit.com": "www.reddit.com",
  "www.reddit.com": "www.reddit.com",
  "old.reddit.com": "www.reddit.com",
  "news.ycombinator.com": "news.ycombinator.com",
  "facebook.com": "www.facebook.com",
  "www.facebook.com": "www.facebook.com",
  "m.facebook.com": "www.facebook.com",
  "threads.com": "www.threads.com",
  "www.threads.com": "www.threads.com",
  "threads.net": "www.threads.com",
  "www.threads.net": "www.threads.com",
};

/**
 * The one URL a conversation is stored and de-duplicated under, or null when it is not a conversation we may show.
 * Google hands back the same Threads post under both domains and Facebook adds tracking params, and
 * `opportunities (user_id, url)` is unique: two spellings would be two cards for one post. Hacker News keeps its query,
 * because the item id is in it.
 */
export function normalizeConversationUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = HOSTS[url.hostname.toLowerCase()];
  if (url.protocol !== "https:" || !host || url.username || url.password || url.port) return null;
  const path = url.pathname;
  switch (host) {
    case "www.reddit.com":
      // Reddit's form is kept as the reader gives it (rows already stored use it); only a thread is a conversation.
      return /^\/r\/[A-Za-z0-9_]{2,21}\/comments\/[a-z0-9_-]+(\/|$)/i.test(path) ? `https://${host}${path}` : null;
    case "news.ycombinator.com":
      return path === "/item" && /^\?id=\d{1,12}$/.test(url.search) ? `https://${host}/item${url.search}` : null;
    case "www.facebook.com": {
      // One post, one URL: `permalink` and `posts` are the same page, and so are a trailing slash and any case of the
      // group's name. A group's numeric id and its vanity name cannot be matched without a lookup.
      const m = /^\/groups\/([A-Za-z0-9._-]{1,100})\/(?:posts|permalink)\/([0-9]{1,30})\/?$/.exec(path);
      return m ? `https://${host}/groups/${m[1]!.toLowerCase()}/posts/${m[2]}` : null;
    }
    default: {
      // Google links a Threads post as /@user/post/<code>/<slug>/: the code is the post, the slug is only words.
      const m = /^\/@([A-Za-z0-9._]{1,30})\/post\/([A-Za-z0-9_-]{1,40})(?:\/.*)?$/.exec(path);
      return m ? `https://${host}/@${m[1]}/post/${m[2]}` : null;
    }
  }
}

/** The known platforms in `raw`, once each, in list order; anything that is not a list gives none. */
export function parsePlatforms(raw: unknown): SalesPlatform[] {
  if (!Array.isArray(raw)) return [];
  return SALES_PLATFORMS.filter((p) => raw.includes(p));
}
