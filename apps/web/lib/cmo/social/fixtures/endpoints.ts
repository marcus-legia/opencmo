/**
 * Every ScrapeCreators endpoint `research.ts` reads, with the call that reads it (cmo-review-2 S3.4).
 *
 * One list for both sides: `scripts/scrapecreators-fixtures.mts` calls each once with the real key and saves the body;
 * `fixtures.check.ts` feeds each saved body to the same reader. A fixture is `assumed` until that script has run: it was
 * written from the paths the parsers read, because the provider's docs host was unreachable from where this was built.
 * An `assumed` fixture proves the reader's plumbing, not the provider's shape; a `real` one proves both.
 */
import {
  creditBalance,
  googleSearch,
  redditSearch,
  redditThread,
  subredditDetails,
  subredditPosts,
  tiktokSearch,
  transcript,
  xProfile,
  xTopPosts,
  xTweet,
  youtubeSearch,
} from "../research";
import { facebookCandidates, readFacebookPost } from "../facebook";
import { readThreadsPost, threadsCandidates } from "../threads-search";

export type Fixture = {
  source: "assumed" | "real";
  path: string;
  params: Record<string, string>;
  capturedAt?: string;
  body: unknown;
};

/** What a read must give back from a body of the right shape. Throws when it gave nothing usable. */
type Expect = (result: unknown) => void;
const nonEmpty = (what: string): Expect => (result) => {
  if (!Array.isArray(result) || result.length === 0) throw new Error(`${what}: no items`);
  for (const item of result as { url?: string }[]) if (item.url !== undefined && !/^https:\/\//.test(item.url)) throw new Error(`${what}: bad url ${item.url}`);
};

/** Earlier answers a later call reads its input from (a thread link from a search, a video link from a search). */
export type Found = Partial<Record<"redditThread" | "tweet" | "youtubeVideo" | "tiktokVideo" | "instagramPost" | "xVideo" | "facebookPost" | "threadsPost", string>>;

export type Endpoint = {
  name: string;
  path: string;
  /** null: the input is not known yet (the script skips the call and says so). */
  params: (found: Found) => Record<string, string> | null;
  read: (params: Record<string, string>) => Promise<unknown>;
  expect: Expect;
  /** After the call: links later calls need. */
  find?: (result: unknown, found: Found) => void;
};

const firstUrl = (result: unknown, test: RegExp): string | undefined =>
  Array.isArray(result) ? (result as { url?: string }[]).map((item) => item.url).find((url) => url && test.test(url)) : undefined;

export const ENDPOINTS: Endpoint[] = [
  {
    name: "reddit-search",
    path: "/v1/reddit/search",
    params: () => ({ query: "invoicing software for freelancers" }),
    read: (p) => redditSearch(p.query!),
    expect: nonEmpty("reddit search"),
    find: (result, found) => void (found.redditThread ??= firstUrl(result, /\/comments\//)),
  },
  { name: "reddit-subreddit", path: "/v1/reddit/subreddit", params: () => ({ subreddit: "SaaS", sort: "hot" }), read: (p) => subredditPosts(p.subreddit!, undefined, p.sort), expect: nonEmpty("subreddit") },
  {
    name: "reddit-subreddit-details",
    path: "/v1/reddit/subreddit/details",
    params: () => ({ subreddit: "SaaS", cache_max_age: "7d" }),
    read: (p) => subredditDetails(p.subreddit!),
    expect: (result) => {
      const { rules, description } = result as { rules: string; description: string };
      if (!rules && !description) throw new Error("subreddit details: no rules and no description");
    },
  },
  {
    name: "reddit-post-comments",
    path: "/v1/reddit/post/comments",
    params: (found) => (found.redditThread ? { url: found.redditThread } : null),
    read: (p) => redditThread(p.url!),
    expect: (result) => {
      const { post, comments } = result as { post: unknown; comments: unknown[] };
      if (!post) throw new Error("reddit thread: no post");
      if (!comments.length) throw new Error("reddit thread: no comments");
    },
  },
  {
    name: "twitter-profile",
    path: "/v1/twitter/profile",
    params: () => ({ handle: "levelsio" }),
    read: (p) => xProfile(p.handle!),
    expect: (result) => {
      if (!(result as { followers: number }).followers) throw new Error("x profile: no follower count");
    },
  },
  {
    name: "twitter-user-tweets",
    path: "/v1/twitter/user-tweets",
    params: () => ({ handle: "levelsio" }),
    read: (p) => xTopPosts(p.handle!),
    expect: nonEmpty("x posts"),
    find: (result, found) => void (found.tweet ??= firstUrl(result, /\/status\//)),
  },
  {
    name: "twitter-tweet",
    path: "/v1/twitter/tweet",
    params: (found) => (found.tweet ? { url: found.tweet } : null),
    read: (p) => xTweet(p.url!),
    expect: (result) => {
      if (!result || !(result as { url?: string }).url) throw new Error("x tweet: nothing read");
    },
  },
  {
    name: "tiktok-search",
    path: "/v1/tiktok/search/keyword",
    params: () => ({ query: "small business marketing" }),
    read: (p) => tiktokSearch(p.query!),
    expect: nonEmpty("tiktok search"),
    find: (result, found) => void (found.tiktokVideo ??= firstUrl(result, /\/video\//)),
  },
  {
    name: "youtube-search",
    path: "/v1/youtube/search",
    params: () => ({ query: "how to get first customers saas" }),
    read: (p) => youtubeSearch(p.query!),
    expect: nonEmpty("youtube search"),
    find: (result, found) => void (found.youtubeVideo ??= firstUrl(result, /watch\?v=/)),
  },
  { name: "google-search", path: "/v1/google/search", params: () => ({ query: "invoicing software for freelancers reddit" }), read: (p) => googleSearch(p.query!), expect: nonEmpty("google search") },
  ...(
    [
      ["youtube-transcript", "/v1/youtube/video/transcript", "youtubeVideo"],
      ["tiktok-transcript", "/v1/tiktok/video/transcript", "tiktokVideo"],
      ["instagram-transcript", "/v2/instagram/media/transcript", "instagramPost"],
      ["twitter-transcript", "/v1/twitter/tweet/transcript", "xVideo"],
    ] as const
  ).map(
    ([name, path, from]): Endpoint => ({
      name,
      path,
      params: (found) => (found[from] ? { url: found[from]! } : null),
      read: (p) => transcript(p.url!),
      expect: (result) => {
        if (!(result as { text: string }).text) throw new Error(`${name}: no text`);
      },
    }),
  ),
  // Sales finder A3: Facebook group and Threads posts are found through Google, then read one by one.
  {
    name: "google-facebook-groups",
    path: "/v1/google/search",
    params: () => ({ query: "site:facebook.com/groups need help with invoicing clients", date_posted: "last-month" }),
    read: (p) => googleSearch(p.query!, undefined, { datePosted: "last-month" }),
    expect: nonEmpty("google facebook groups"),
    find: (result, found) => {
      found.facebookPost = facebookCandidates(result as Parameters<typeof facebookCandidates>[0])[0]?.url;
    },
  },
  {
    name: "facebook-post",
    path: "/v1/facebook/post",
    params: (found) => (found.facebookPost ? { url: found.facebookPost, cache_max_age: "7d" } : null),
    read: (p) => readFacebookPost(p.url!),
    expect: (result) => {
      if (!(result as { text: string }).text) throw new Error("facebook post: no text");
    },
  },
  {
    name: "google-threads",
    path: "/v1/google/search",
    params: () => ({ query: "site:threads.com need help with invoicing clients", date_posted: "last-month" }),
    read: (p) => googleSearch(p.query!, undefined, { datePosted: "last-month" }),
    expect: nonEmpty("google threads"),
    find: (result, found) => {
      found.threadsPost = threadsCandidates(result as Parameters<typeof threadsCandidates>[0])[0]?.url;
    },
  },
  {
    name: "threads-post",
    path: "/v1/threads/post",
    params: (found) => (found.threadsPost ? { url: found.threadsPost, cache_max_age: "7d" } : null),
    read: (p) => readThreadsPost(p.url!),
    expect: (result) => {
      if (!(result as { text: string }).text) throw new Error("threads post: no text");
    },
  },
  {
    name: "credit-balance",
    path: "/v1/credit/balance",
    params: () => ({}),
    read: () => creditBalance(),
    expect: (result) => {
      if (typeof result !== "number" || result <= 0) throw new Error("credit balance: no number");
    },
  },
];
