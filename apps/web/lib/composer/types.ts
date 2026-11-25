/**
 * The Composer's contracts (plan docs/superpowers/plans/2026-11-25-composer.md): what the context API serves, what a
 * check returns. The data part (local session) and the screen (cloud session) both code against these. Pure types.
 */
export const COMPOSE_PLATFORMS = ["reddit", "x", "threads", "linkedin"] as const;
export type ComposePlatform = (typeof COMPOSE_PLATFORMS)[number];

export type SubRule = { n: number; title: string; text: string };
export type SubredditContext = {
  name: string;                 // "SaaS"
  rules: SubRule[];             // parsed, numbered
  submitText: string;           // the sub's posting guidance, plain text, ≤ 2000 chars
  verdict: "safe" | "requires_disclosure" | "no_product_mention" | "not_verified" | "skip";
  summary: string;
  minKarma: number | null;
  minAccountAgeDays: number | null;
  megathread: boolean;
  guide: { avoid: string[]; use: string[] };   // ≤ 8 each, ≤ 120 chars each
  readAt: string;               // ISO
};
export type AccountContext = {
  username: string | null;      // without "u/"
  karma: number | null;         // typed by the founder
  accountCreatedAt: string | null; // ISO month start, typed by the founder
  postsInSub: number | null;    // from author: search, last 12 months; null when the search could not tell
  lastPostInSubAt: string | null;
};
export type Readiness = { level: "ready" | "caution" | "not_ready" | "unknown"; reasons: string[] };
export type ComposerContext = { platform: ComposePlatform; subreddit: SubredditContext | null; account: AccountContext; readiness: Readiness };

export type ComposeIssue = {
  quote: string;                // exact text from the title or body ("" for whole-post issues)
  field: "title" | "body";
  source: "code" | "ai";
  rule: string;                 // "Rule 3", "No AI slop", "Length", "Links"
  severity: "block" | "warn";
  why: string;                  // ≤ 200 chars
  suggestion: string | null;    // ≤ 300 chars; a rewrite of that sentence only
};
export type ComposeCheckOutput = { verdict: "ok" | "fix"; summary: string; issues: ComposeIssue[] };
