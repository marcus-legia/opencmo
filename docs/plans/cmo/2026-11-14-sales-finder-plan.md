# Sales finder v1: conversations on Reddit, Hacker News, Facebook groups and Threads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (one session per file in
> [`2026-11-14-sales-finder-sessions/`](2026-11-14-sales-finder-sessions/)). Steps use checkbox (`- [ ]`) syntax.

**Goal:** the founder asks the CMO chat "find people who …", picks nothing technical, and Sales finds conversations on
Reddit, Hacker News, public Facebook groups and Threads, scores them with exact quotes and drafts help-first replies the
founder posts by hand.

**Architecture:** the existing `sales_scan` job becomes multi-platform. Each platform is one finder in
`apps/web/lib/cmo/social/` that returns the same `ConversationThread` shape; the job runs the finders the run asks for
(`input.platforms`) intersected with the founder's switches (`sales_settings.platforms`), then scores, checks rules,
drafts and saves into `opportunities` exactly as today. The CMO chat already starts a priced scan through
`create_task` (agent `sales`), shows the price card, follows the run and opens Sales; it gains a `platforms` field.
No new table: `opportunities.platform` is widened.

**Tech stack:** Next.js 16 / React 19 (apps/web), Supabase Postgres + pgTAP, ScrapeCreators (`scGet`), Claude through
`ctx.think`.

**Spec:** [`2026-10-31-sales-finder-spec.md`](2026-10-31-sales-finder-spec.md) §2–§5, cut down by the owner on
2026-11-14 (conversation in the session that wrote this plan):

- **In:** conversations only, from the CMO chat and Scan now; platforms Reddit, Hacker News, Facebook groups, Threads.
- **Out of v1:** X (ScrapeCreators has no post search; the official X API is $0.005 per post read and needs prepaid
  credits: a later phase, §Later), creators and creator emails, LinkedIn (no search anywhere), the `leads` table.
- **R0 stays open:** v1 is built and tested on the owner's account. Selling it waits on the owner's R0 decision.

**Branch and PR:** every session works on `claude/sales-finder` and its one PR to `main`. Commit and push after each
task (CLAUDE.md, "Commit and push as you go"). Nobody merges, deploys or force-pushes.

## Facts this plan is built on (checked 2026-11-14)

| Source | What it gives | Credits |
|---|---|---|
| `GET /v1/google/search` | `query`, `date_posted` ∈ `last-hour, last-day, last-week, last-month, last-year`, `page` 1–11; `results[]`: `url`, `title`, `description` | 1 per call, 0 on "no results" (404) |
| `GET /v1/threads/post` | `url`, `trim`, `cache_max_age` ∈ `1d,3d,7d,14d,30d`; text `post.caption.text`, author `post.user.username`, time `post.taken_at` (epoch s), likes `post.like_count`, replies `post.text_post_app_info.direct_reply_count`; `comments[]`: `user.username`, `caption.text`, `like_count`, `taken_at` | 1, 0 when cached |
| `GET /v1/facebook/post` | `url`, `cache_max_age`; `description`, `author.name`, `creation_time`, `comment_count`, `url`. **Group post URLs are not documented** | 1, 0 when cached |
| `GET /v1/facebook/post/comments` | comments of a post (shape to capture in A3) | 1 |
| ScrapeCreators | no keyword search for X, Threads, Facebook or LinkedIn posts (`llms.txt`, 2026-11-14) | — |
| Live test 2026-10-31 | `site:facebook.com/groups` + last month gave 10 real group posts; `site:x.com` gave profiles | — |

Threads posts now live on `threads.com` (the doc's example); `threads.net` still redirects. Match both.

## Global constraints

- "Assist, never act": no post, send, like or follow button anywhere; Sales stays copy-and-open.
- Replies: no links, at most 120 words (`REPLY_MAX_WORDS`), at most 1 product mention in the last 10 replies counted
  across every platform (`MENTION_WINDOW`), `NO_AI_SLOP` stays in `REPLY_SYSTEM`.
- Facebook groups and Threads have no rules endpoint: their rule is `no_product_mention` with a one-line reason, like
  Hacker News (`HN_RULE`).
- All outside text goes through `cleanUntrusted` / `escapeForTag` before a prompt (`apps/web/lib/cmo/untrusted.ts`).
- Every URL saved passes `safeUrl` with a host allowlist; nothing else is stored or shown.
- The founder's excluded subreddits and term pairs apply before anything is scored.
- Price stays `sales_scan` = 5 credits; the scan's ScrapeCreators reads stay ≤ 40 calls (`SC_SCAN_LIMIT`).
- English everywhere in the repo, including SQL `raise exception` text. Comments say why.
- Every migration has a pgTAP test; regenerate `supabase/schema/current.sql` with `scripts/dump-schema.sh`.
- Each commit is green for what it touches: `npm run typecheck`, the `npx tsx …check.ts` files named in the task,
  `npm run db:test` when SQL changed.

## Review focus

1. A Google result that is a group's home page, a profile or a login wall instead of a post: dropped, never scored.
2. `/v1/facebook/post` refuses group URLs or returns empty text: the finder keeps the Google title and description as
   the text, and the scan still finishes.
3. A platform finder that throws (no key, 5xx, budget hit) fails only that platform's step; the scan fails only when
   every platform found nothing because every read failed.
4. A founder who turned every platform off, or a chat brief asking only for a platform that is off: the price card and
   `create_task` refuse before any credit is held, with a sentence that says which switch to turn on.
5. The same conversation found twice (Google gives `threads.net` and `threads.com` URLs, or `?` tracking params):
   one row (`opportunities_user_id_url_key`), because URLs are normalised before the `seen` check.

Each line has its test in the owning task (A3, A3, B1, C1, A2).

## Sessions

| Session | Owns | Waits on |
|---|---|---|
| [A — data and finders](2026-11-14-sales-finder-sessions/A.md) | SQL migration + pgTAP + schema dump; `lib/cmo/social/conversations.ts`, `facebook.ts`, `threads-search.ts` and their fixtures/checks; `lib/cmo/jobs/types.ts` (blocks `Opportunity.platform`, `ReplyOutcomeDue.platform`, `SalesSettings`); `lib/cmo/jobs/store.ts` and `memory-store.ts` (`salesSettings`) | nothing; **A1 is pushed first** |
| [B — the scan job](2026-11-14-sales-finder-sessions/B.md) | `lib/cmo/jobs/sales-scan.ts`, `price-card.ts`, `reply-outcomes.ts`, `runner.ts` (the `searchConversations` test hook), `eval/cases/sales.ts`, the Sales part of `jobs.check.ts` | A1 (types), then A3 (real finders; B uses the hook until then) |
| [C — chat, screen and docs](2026-11-14-sales-finder-sessions/C.md) | `lib/agent/cmo-tools.ts`, `lib/agent/prompt.ts`, `lib/agent/cmo-decisions.ts`, `app/api/v1/sales/settings/route.ts`, `lib/screens/sales.ts`, the `sales` loader in `lib/screens/load.ts`, `lib/screens/fixtures` (sales), `components/today/AgentSales.tsx`, `components/screens/sales/SalesSettings.tsx`, `docs/architecture/research-sales.{md,html}`, this plan's README row and the spec's status line | A1 (types), A2 (SQL), B2 (`salesScanCard(brief, platforms)`) |

Order: A1 → (A2, A3, B1, C1 in parallel) → B2 → C2, C3 → reviews (below) → C4 docs.

### The shared building block (A1, built once)

`apps/web/lib/cmo/social/conversations.ts`, pure, imported by B and C:

```ts
export const SALES_PLATFORMS = ["reddit", "hn", "facebook", "threads"] as const;
export type SalesPlatform = (typeof SALES_PLATFORMS)[number];
export const PLATFORM_LABEL: Record<SalesPlatform, string> = { reddit: "Reddit", hn: "Hacker News", facebook: "Facebook groups", threads: "Threads" };
/** One conversation from any platform, in the shape the scan scores (RedditThread plus its platform). */
export type ConversationThread = { platform: SalesPlatform; url: string; community: string; title: string; author: string; text: string; comments: number; postedAt: string | null };
export function normalizeConversationUrl(raw: string): string | null; // https only, host allowlist, drop query and hash, threads.net → threads.com, lowercase host
export function parsePlatforms(raw: unknown): SalesPlatform[]; // keeps known values, de-duplicates, in SALES_PLATFORMS order; [] for anything else
```

## Code review after each session

When a session has pushed its last task, it runs, on its own commits only (`git log --author` is not enough; use the
range from the session's first to last commit):

1. `/code-review high` on that range, then the `security-review-checklist` skill (this work touches SQL, credits,
   untrusted outside text and an RPC).
2. Fix every CONFIRMED finding in a new commit `<Session>: review fixes`, push, and write the findings and what was
   done with each under **Review** in the session's file.
3. A finding that belongs to another session's files goes in that session's file under **Requests**, not into its code.

After all three sessions: one `/code-review high` on the whole PR (`origin/main...claude/sales-finder`), by session C,
before C4.

## Later (not in v1)

- **X:** a finder on the official X API v2 `GET /2/tweets/search/recent` (last 7 days, pay-per-use $0.005 per post
  read, 2026-11-14 pricing page). Needs: an X developer app with prepaid credits, `X_API_BEARER` on Vercel, a price
  for a scan that includes X (it cannot stay 5 credits at ~50 posts), `provider_prices` rows, and `x` in
  `SALES_PLATFORMS` and the SQL check. Its own plan.
- Threads keyword search through Meta's API (`threads_keyword_search`, app review, the founder's token).
- Creators and emails (spec §2, §4a.5), after R0.
