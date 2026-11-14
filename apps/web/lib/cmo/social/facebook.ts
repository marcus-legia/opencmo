/**
 * Facebook group posts for Sales (Sales finder A3). ScrapeCreators cannot search Facebook, so Google finds public group
 * posts (`site:facebook.com/groups`, last month; the live test of 2026-10-31 gave real asks this way), then each post's
 * own text is read through `/v1/facebook/post`. In a group the ask is the post itself, so comments are not read: that
 * would double the lookups for little.
 *
 * Outside text: it is cleaned of invisible characters here and wrapped as data by the scan's prompt (`threadBlock`).
 */
import { cleanUntrusted } from "../untrusted";
import { googleSearch, type WebResult } from "./research";
import { isoTime, num, scFakeAllowed, scGet, SocialReadError, str, type ScBudget } from "./scrapecreators";
import { normalizeConversationUrl, type ConversationThread } from "./conversations";

/** A group post's own page, as `normalizeConversationUrl` keeps it; the same shape `opportunities_url_check` takes. */
export const FACEBOOK_POST = /^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9._-]{1,100}\/(posts|permalink)\/[0-9]{1,30}\/?$/;
const MAX_AGE_MS = 30 * 86_400_000;
const TEXT_MAX = 2000;

export type FacebookPost = { text: string; author: string; postedAt: string | null; comments: number };

const clean = (s: string, max: number) => cleanUntrusted(s).replace(/[ \t]+/g, " ").trim().slice(0, max);
/** Google's page title without the site's name ("Finding clients - Facebook", "… | Group | Facebook"). */
const postTitle = (title: string) => title.split(" | ")[0]!.replace(/\s+[-–|]\s*Facebook\s*$/i, "");

/** "Need help invoicing | Freelancers Hub | Facebook" → "Freelancers Hub". */
export function groupName(title: string): string {
  const parts = title.split(" | ").map((p) => p.trim());
  return parts.length >= 3 && /^facebook$/i.test(parts.at(-1)!) ? parts.at(-2)!.slice(0, 100) : "Facebook group";
}

/** Google results that are group posts, once each, in Google's order. A group's home, a profile or a login wall is not. */
export function facebookCandidates(results: WebResult[]): (WebResult & { url: string })[] {
  const seen = new Set<string>();
  return results.flatMap((r) => {
    const url = normalizeConversationUrl(r.url);
    if (!url || !FACEBOOK_POST.test(url) || seen.has(url)) return [];
    seen.add(url);
    return [{ ...r, url }];
  });
}

/** One public post (`/v1/facebook/post`, cached a week). */
export async function readFacebookPost(url: string, budget?: ScBudget): Promise<FacebookPost> {
  const json = (await scGet("/v1/facebook/post", { url, cache_max_age: "7d" }, budget)) as Record<string, unknown> | null;
  const author = json && typeof json.author === "object" && json.author ? str((json.author as Record<string, unknown>).name) : "";
  return { text: clean(str(json?.description), TEXT_MAX), author: clean(author, 100), postedAt: isoTime(json?.creation_time), comments: num(json?.comment_count) };
}

/**
 * Public Facebook group posts about `query` from the last month. One Google lookup, then up to `readPosts` post reads
 * (default 4). A post that cannot be read keeps Google's title and description as its text: the scan still scores it.
 */
export async function searchFacebookGroups(query: string, budget: ScBudget, opts: { readPosts?: number } = {}): Promise<ConversationThread[]> {
  if (scFakeAllowed()) return fakeFacebook(query);
  const candidates = facebookCandidates(await googleSearch(`site:facebook.com/groups ${query}`, budget, { datePosted: "last-month" }));
  const readPosts = Math.max(0, opts.readPosts ?? 4);
  const out: ConversationThread[] = [];
  for (const [i, c] of candidates.entries()) {
    let post: FacebookPost | null = null;
    if (i < readPosts) {
      try {
        post = await readFacebookPost(c.url, budget);
      } catch (error) {
        // Not documented for group URLs, a private post, or the scan's budget used up: Google's words still count.
        if (!(error instanceof SocialReadError) || error.kind === "setup") throw error;
      }
    }
    if (post?.postedAt && Date.now() - Date.parse(post.postedAt) > MAX_AGE_MS) continue;
    const text = post?.text || clean(`${c.title}\n${c.description}`, TEXT_MAX);
    if (!text) continue;
    out.push({
      platform: "facebook",
      url: c.url,
      community: groupName(c.title),
      title: clean(post?.text ? post.text.split("\n")[0]! : postTitle(c.title), 120) || "Facebook group post",
      author: post?.author ?? "",
      text,
      comments: post?.comments ?? 0,
      postedAt: post?.postedAt ?? null,
    });
  }
  return out;
}

function fakeFacebook(query: string): ConversationThread[] {
  return [1, 2].map((n) => ({
    platform: "facebook" as const,
    url: `https://www.facebook.com/groups/freelancers/posts/10000${n}/`,
    community: "Freelancers Hub",
    title: `Anyone else stuck on ${query}?`,
    author: "",
    text: `Anyone else stuck on ${query}? I lose hours every week on it and my clients keep paying late. What do you use?`,
    comments: 4 + n,
    postedAt: null,
  }));
}
