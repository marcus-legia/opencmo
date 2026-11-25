/**
 * The Composer's sample data (`?sample=1`, never in production): the context and an AI check result as the data part
 * will serve them, so the screen and its e2e run before the context API and the `compose_check` job are live. The
 * rules are r/SaaS's as Lurk returned them on 2026-11-25, shortened.
 */
import type { ComposeCheckOutput, ComposePlatform, ComposerContext } from "./types";

export function sampleContext(platform: ComposePlatform, subreddit: string | null): ComposerContext {
  const account = { username: "my_handle", karma: 120, accountCreatedAt: "2026-03-01", postsInSub: 0, lastPostInSubAt: null };
  if (platform !== "reddit" || !subreddit)
    return { platform, subreddit: null, account, readiness: { level: platform === "reddit" ? "unknown" : "ready", reasons: [] } };
  return {
    platform,
    subreddit: {
      name: subreddit,
      rules: [
        { n: 1, title: "Submission Guidelines", text: "Posts must be about building, running or growing a SaaS. Low-effort posts are removed." },
        { n: 2, title: "Posting SaaS Relevant Content Only", text: "Generic business, crypto or MLM content is removed." },
        { n: 3, title: "No Vendor Spam on posts or comments", text: "Promote your product at most once every 60 days, and say it is yours first." },
      ],
      submitText: "Share what you learned, with numbers if you have them. Promotion goes in the weekly thread.",
      verdict: "requires_disclosure",
      summary: "Self-promotion only with disclosure, at most once every 60 days.",
      minKarma: null,
      minAccountAgeDays: null,
      megathread: true,
      guide: {
        avoid: ['"my tool", "check out", "DM me"', "Links in the post", "Generic business advice with no SaaS angle"],
        use: ["A concrete SaaS problem you had", "Numbers you have", "A question the sub can answer"],
      },
      readAt: "2026-11-25T06:00:00.000Z",
    },
    account,
    readiness: { level: "caution", reasons: [`Comment in r/${subreddit} for a week before your first post.`] },
  };
}

/** A check that flags the first sentence of the body, so the sample shows an AI issue with Apply and Ignore. */
export function sampleCheck(body: string): ComposeCheckOutput {
  const first = body.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).find(Boolean) ?? "";
  if (!first) return { verdict: "ok", summary: "Nothing to check yet.", issues: [] };
  return {
    verdict: "fix",
    summary: "One sentence reads as promotion without disclosure.",
    issues: [
      {
        quote: first,
        field: "body",
        source: "ai",
        rule: "Rule 3",
        severity: "warn",
        why: "Reads as promotion before you say the product is yours.",
        suggestion: `Disclosure: I built a tool for this. ${first}`.slice(0, 300),
      },
    ],
  };
}
