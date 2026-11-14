/**
 * Facebook group posts for Sales (Sales finder A3). ScrapeCreators cannot search Facebook, so Google finds public group
 * posts (`site:facebook.com/groups`, last month; the live test of 2026-10-31 gave real asks this way), then each post's
 * own text is read through `/v1/facebook/post`, which reads group posts (checked live 2026-11-14). In a group the ask is
 * the post itself, so comments are not read: that would double the lookups for little.
 *
 * Outside text: it is cleaned of invisible characters here and wrapped as data by the scan's prompt (`threadBlock`).
 */
import { cleanUntrusted } from "../untrusted";
import type { WebResult } from "./research";
import { isoTime, num, scFakeAllowed, scGet, str, type ScBudget } from "./scrapecreators";
import type { ConversationThread } from "./conversations";
import { findPostsViaGoogle, postCandidates, type Candidate, type PostRead } from "./google-posts";

/** A group post's own page, as `normalizeConversationUrl` keeps it; within what `opportunities_url_check` takes. */
export const FACEBOOK_POST = /^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9._-]{1,100}\/(posts|permalink)\/[0-9]{1,30}\/?$/;
const TEXT_MAX = 2000;

export type FacebookPost = PostRead;

const clean = (s: string, max: number) => cleanUntrusted(s).replace(/[ \t]+/g, " ").trim().slice(0, max);
/** Google's page title without the site's name ("Finding clients - Facebook", "… | Group | Facebook"). */
const postTitle = (title: string) => title.split(" | ")[0]!.replace(/\s+[-–|]\s*Facebook\s*$/i, "");

/**
 * The group's name as far as we can tell: Google's titles name no group, and the post read has no group field, so a
 * vanity name in the link is the best there is. A numeric id is not a name.
 */
export function groupName(url: string): string {
  const slug = /\/groups\/([^/]+)\//.exec(url)?.[1] ?? "";
  return slug && !/^\d+$/.test(slug) ? slug.slice(0, 100) : "Facebook group";
}

/** Google results that are group posts, once each, in Google's order. A group's home, a profile or a login wall is not. */
export const facebookCandidates = (results: WebResult[]): Candidate[] => postCandidates(results, FACEBOOK_POST);

/** One public post (`/v1/facebook/post`, cached a week). */
export async function readFacebookPost(url: string, budget?: ScBudget): Promise<FacebookPost> {
  const json = (await scGet("/v1/facebook/post", { url, cache_max_age: "7d" }, budget)) as Record<string, unknown> | null;
  const author = json && typeof json.author === "object" && json.author ? str((json.author as Record<string, unknown>).name) : "";
  return { text: clean(str(json?.description), TEXT_MAX), author: clean(author, 100), postedAt: isoTime(json?.creation_time), comments: num(json?.comment_count) };
}

/**
 * Public Facebook group posts about `query` from the last month: one Google lookup, then up to `readPosts` reads
 * (default 4) of posts the founder has not seen (`skip`).
 */
export async function searchFacebookGroups(query: string, budget: ScBudget, opts: { readPosts?: number; skip?: (url: string) => boolean } = {}): Promise<ConversationThread[]> {
  if (scFakeAllowed()) return fakeFacebook(query).filter((t) => !opts.skip?.(t.url));
  return findPostsViaGoogle({
    site: "facebook.com/groups",
    query,
    budget,
    pattern: FACEBOOK_POST,
    readPosts: opts.readPosts,
    skip: opts.skip,
    read: readFacebookPost,
    toThread: (c, post) => {
      const text = post?.text || clean(`${postTitle(c.title)}\n${c.description}`, TEXT_MAX);
      if (!text) return null;
      return {
        platform: "facebook",
        url: c.url,
        community: groupName(c.url),
        title: clean(post?.text ? post.text.split("\n")[0]! : postTitle(c.title), 120) || "Facebook group post",
        author: post?.author ?? "",
        text,
        comments: post?.comments ?? 0,
        postedAt: post?.postedAt ?? null,
      };
    },
  });
}

function fakeFacebook(query: string): ConversationThread[] {
  return [1, 2].map((n) => ({
    platform: "facebook" as const,
    url: `https://www.facebook.com/groups/freelancers/posts/10000${n}`,
    community: "freelancers",
    title: `Anyone else stuck on ${query}?`,
    author: "",
    text: `Anyone else stuck on ${query}? I lose hours every week on it and my clients keep paying late. What do you use?`,
    comments: 4 + n,
    postedAt: null,
  }));
}
