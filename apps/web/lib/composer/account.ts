/**
 * Whether the founder's Reddit account is ready for a sub (plan 2026-11-25, Part L). "Removed by Reddit's filters"
 * mostly acts on the account: low karma, a new account, no history in the sub. No API Ferreto uses reads a Reddit
 * profile, so karma and account age are what the founder typed; their posts per sub come from an `author:` search.
 */
import { redditSearch } from "../cmo/social/research";

import type { AccountContext, Readiness, SubredditContext } from "./types";

/** A Reddit username without "u/", or null when it is not one (the same rule as SQL `save_reddit_account`). */
export function redditUser(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim().replace(/^\/?u\//i, "");
  return /^[A-Za-z0-9_-]{3,20}$/.test(name) ? name : null;
}

/** The founder's posts in one sub over the last year, newest first. Only a valid username is searched. */
export async function postsIn(username: string, sub: string): Promise<{ postsInSub: number | null; lastPostInSubAt: string | null }> {
  const user = redditUser(username);
  if (!user) return { postsInSub: null, lastPostInSubAt: null };
  const posts = await redditSearch(`author:${user}`, undefined, { sort: "new", timeframe: "year" });
  const own = posts.filter((p) => p.author.replace(/^u\//, "").toLowerCase() === user.toLowerCase());
  const mine = own.filter((p) => p.community.replace(/^r\//, "").toLowerCase() === sub.toLowerCase());
  const last = mine.map((p) => p.postedAt).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
  // The search gives one page of the newest posts: none here among a full page elsewhere says nothing about this sub.
  if (!mine.length && own.length >= 25) return { postsInSub: null, lastPostInSubAt: null };
  return { postsInSub: mine.length, lastPostInSubAt: last };
}

const DAY = 86_400_000;
/** Below these, Reddit's own filter often removes a new post wherever it goes (owner test 2026-11-25). */
export const LOW_KARMA = 50;
export const NEW_ACCOUNT_DAYS = 30;

/**
 * Ready, caution, not ready or unknown, with the reasons. Never "ready" while karma or account age is unknown: the
 * founder would read it as "safe to post".
 */
export function readiness(sub: SubredditContext | null, account: AccountContext, now = new Date()): Readiness {
  const reasons: string[] = [];
  const where = sub ? `r/${sub.name}` : "this community";
  if (!account.username) return { level: "unknown", reasons: ["Add your Reddit username to check your account before you post."] };
  // The founder gives a month: count from its last day, so a sub's minimum is never met too early (review 2026-11-25).
  const created = account.accountCreatedAt ? new Date(account.accountCreatedAt) : null;
  const monthEnd = created ? Date.UTC(created.getUTCFullYear(), created.getUTCMonth() + 1, 0) : null;
  const ageDays = monthEnd !== null ? Math.max(0, Math.floor((now.getTime() - monthEnd) / DAY)) : null;
  let notReady = false;
  if (sub?.verdict === "skip") {
    notReady = true;
    reasons.push(`${where}'s rules leave no room for this kind of post.`);
  }
  if (sub?.minKarma != null && account.karma != null && account.karma < sub.minKarma) {
    notReady = true;
    reasons.push(`${where} asks for ${sub.minKarma} karma; you have ${account.karma}.`);
  }
  if (sub?.minAccountAgeDays != null && ageDays != null && ageDays < sub.minAccountAgeDays) {
    notReady = true;
    reasons.push(`${where} asks for an account at least ${sub.minAccountAgeDays} days old; yours is ${ageDays}.`);
  }
  if (notReady) return { level: "not_ready", reasons };
  let caution = false;
  if (account.karma != null && account.karma < LOW_KARMA) {
    caution = true;
    reasons.push(`Under ${LOW_KARMA} karma, Reddit's filter often removes new posts. Comment for a while first.`);
  }
  if (ageDays != null && ageDays < NEW_ACCOUNT_DAYS) {
    caution = true;
    reasons.push(`Your account is ${ageDays} days old: Reddit's filter is strict with new accounts.`);
  }
  if (sub && account.postsInSub === 0) {
    caution = true;
    reasons.push(`You have not posted in ${where} yet: comment there for a week before your first post.`);
  }
  if (sub?.megathread) {
    caution = true;
    reasons.push(`${where} keeps self-promotion to its pinned thread.`);
  }
  if (account.karma == null || account.accountCreatedAt == null) {
    reasons.push("Add your karma and account age (on your Reddit profile) to check the rest.");
    return { level: "unknown", reasons };
  }
  return caution ? { level: "caution", reasons } : { level: "ready", reasons: [`Your account meets what ${where} asks.`] };
}
