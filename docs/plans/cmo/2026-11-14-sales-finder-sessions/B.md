# Session B — the scan job

Plan: [`../2026-11-14-sales-finder-plan.md`](../2026-11-14-sales-finder-plan.md). Branch `claude/sales-finder`.
Commit and push after every task. Read the plan's Global constraints first.

**Owns:** `apps/web/lib/cmo/jobs/sales-scan.ts`, `price-card.ts`, `reply-outcomes.ts`, `runner.ts` (the test hook only),
`apps/web/lib/cmo/jobs/eval/cases/sales.ts`, the Sales part of `apps/web/lib/cmo/jobs/jobs.check.ts`.

**Waits on:** A1 (pull it before starting). A3's finders are called through the hook below, so B1 does not wait on A3;
B1's last step wires the real finders once A3 is pushed.

## Tasks

### - [x] B1. One scan over every platform the run and the founder allow

**Consumes:** `SALES_PLATFORMS`, `SalesPlatform`, `ConversationThread`, `normalizeConversationUrl`, `parsePlatforms`
(A1); `SalesSettings.platforms` (A1); `searchFacebookGroups`, `searchThreadsConversations` (A3).

**Produces:**
- `JobContext.searchConversations?: (platform: "facebook" | "threads", query: string) => Promise<ConversationThread[]>`
  and the same on `RunOptions` (`runner.ts`), next to `searchReddit` / `searchHn`.
- `ScanThread = ConversationThread` (Reddit threads get `platform: "reddit"`; `fromHn` sets `"hn"`).
- `export function scanPlatforms(input: Record<string, unknown>, settings: SalesSettings): SalesPlatform[]` — the run's
  `input.platforms` (through `parsePlatforms`; empty or missing means "all") intersected with `settings.platforms`.
- Run output gains `platforms: SalesPlatform[]` and `failed: SalesPlatform[]`.

Decisions:
- Order of steps: `read_doc`, `make_queries`, then one search step per platform in `SALES_PLATFORMS` order, each only
  when the platform is in `scanPlatforms`. New steps: `facebook_search` "Searching Facebook groups" → done label
  `"<n> new Facebook group posts found"` / `"No new Facebook group posts"`; `threads_search` "Searching Threads" →
  `"<n> new Threads posts found"` / `"No new Threads posts"`.
- Facebook and Threads each use the first 3 queries, `readPosts: 4`, one shared `new ScBudget(SC_SCAN_LIMIT_SOCIAL)` with
  `SC_SCAN_LIMIT_SOCIAL = 16`, and keep at most 8 threads each (`SOCIAL_MAX = 8`). The 30-thread cap (`MAX_THREADS`)
  keeps Reddit last to fill: `scanned = [...facebook, ...threads, ...hn]` then Reddit up to 30 in total.
- A platform step catches `SocialReadError` (and `HnReadError`) and records the platform in `failed`; it never fails the
  scan. The scan throws `LlmError` (refund) only when every platform in `scanPlatforms` is in `failed`, with the last
  platform's message. Keep the existing "not set up" key error as an immediate throw.
- `scanPlatforms` empty → throw `LlmError("Sales has nowhere to look. Turn on a platform in Sales settings.")` before any read.
- Every URL goes through `normalizeConversationUrl` before the `seen` check and the de-duplication; `seen` is
  normalised the same way. A thread whose URL normalises to `null` is dropped.
- Rules: `FACEBOOK_RULE = { verdict: "no_product_mention", summary: "Facebook group: rules not read, help only" }`,
  `THREADS_RULE = { verdict: "no_product_mention", summary: "Threads: help only, no product mention" }`; only Reddit
  communities go to `check_rules`.
- Prompts: `QUERY_SYSTEM` and `QueriesSchema` say "search queries for conversations" (not "Reddit"); `threadBlock` adds
  `platform="<label>"`. `REPLY_SYSTEM` adds one line: on Facebook and Threads, write as a comment under the post, not
  as a forum answer. `REPLY_VERSION` changes by itself; the `no-ai-slop.check.ts` entry stays green.
- `Opportunity.platform` is set for every non-Reddit item.

- [x] Failing checks in `jobs.check.ts` (memory store, `searchReddit`/`searchHn`/`searchConversations` stubs, fake model):
  - platforms `{reddit, facebook}` in settings and none in the input: Reddit and Facebook are searched, Threads and HN are not;
  - input `platforms: ["threads"]` with settings `{reddit}`: throws "Sales has nowhere to look…" and no stub was called;
  - Facebook stub throws `SocialReadError`, Reddit returns threads: the run is `done`, `output.failed = ["facebook"]`;
  - every enabled stub throws: the run fails and its credits are refunded;
  - a Threads thread and a `threads.net` copy of a URL already in `seen`: nothing new is scored (Review focus 5);
  - a saved Facebook opportunity has `platform: "facebook"` and `rule: "no_product_mention"`.
- [x] Run `cd apps/web && npx tsx lib/cmo/jobs/jobs.check.ts`: the new checks fail.
- [x] Implement in `sales-scan.ts` and the hook in `runner.ts` (default `searchConversations` still returns `[]`: A3 not pushed yet, wiring left for when it is). Until A3 is pushed the default for
  `searchConversations` is a function that returns `[]`; after A3, the default calls `searchFacebookGroups` /
  `searchThreadsConversations` with the shared budget.
- [x] `reply-outcomes.ts`: outcomes are checked for `reddit` and `hn` only; a due Facebook or Threads outcome is left
  unchecked (filter, same place as the existing `socialReaderReady` filter), with a one-line comment why.
- [x] `npx tsx lib/cmo/jobs/jobs.check.ts`, `npx tsx lib/cmo/skills/no-ai-slop.check.ts`, `npm run typecheck`.
- [x] Commit `Sales finder B1: one scan over Reddit, Hacker News, Facebook groups and Threads`, push.

### - [x] B2. The price card names the places, and the eval covers them

**Produces:** `salesScanCard(brief?: string, platforms?: SalesPlatform[]): PriceCard` — missing or empty means every
platform. First line: `Scan <labels joined with ", " and " and ">: <brief>` (or `… for people who describe the problem
you solve`). Second line unchanged except "skipping the subreddits and term pairs" stays. Third line unchanged.
Credits unchanged (`JOB_PRICES.sales_scan`).

- [x] Failing checks (in `jobs.check.ts`, or `price-card.check.ts` if you create it):
  `salesScanCard("x", ["reddit", "threads"]).changes[0] === "Scan Reddit and Threads: x"`;
  `salesScanCard().changes[0]` names all four.
- [x] Implement. `ScanNow` in `AgentSales.tsx` still calls `salesScanCard()` with no argument (C owns that file).
- [x] Eval: in `eval/cases/sales.ts` add a fake-mode case where the stubs return one Facebook and one Threads thread
  with a clear pain; it expects two cards, both `no_product_mention`, each reply under 120 words with no link.
  Fake run: `w4` 10/10 (`w4:social:*` 4/4). Run the sales eval the way `docs/plans/agents/2026-10-17-agent-evals-plan.md` says (fake mode).
- [x] Commit `Sales finder B2: the scan's price card names where it looks`, push.

Also changed: `e2e/cmo.spec.ts` asserted the old card text ("Scan Reddit and Hacker News"); it now checks "Scan Reddit", which holds for every card the chat shows by default.

### - [ ] B3. Review (plan §Code review after each session)

## Review

(findings and what was done)

## Requests

(from other sessions)
