# Session A — data and SQL

Plan: [`../2026-11-20-wave3-plan.md`](../2026-11-20-wave3-plan.md). Branch `claude/launch`. Load the
`supabase-migrations` skill before SQL. Migrations from `20270201010000`, pgTAP from `338_`.

**Owns:** new migrations and pgTAP, `supabase/schema/current.sql`, `apps/web/lib/cmo/library.ts`,
`apps/web/lib/cmo/reach.ts` (+ checks), the schemas in `apps/web/lib/cmo/documents.ts`, store / memory-store methods
for the new tables (`lib/cmo/jobs/store.ts`, `memory-store.ts`, `types.ts` blocks named below), the screens loader
blocks for Library and Research (`lib/screens/load.ts`, new `lib/screens/library.ts` fields).

## Tasks

### - [x] A1. Contract (push first)
Create `lib/cmo/library.ts` and `lib/cmo/reach.ts` with the plan's types and zod schemas, `PostSource` in
`lib/cmo/jobs/types.ts`. A `reachLevel(check)` helper with its check: email ready needs DM ready + `emailFound` +
warm; DM ready needs buyer, wants now, fresh, `dmAllowed` and (warm or the post asks for tools). Commit and push.

### - [x] A2. Library tables
- `library_themes (id, user_id, name, created_at)`, `library_entries (opportunity_id pk → opportunities, user_id,
  theme_id, summary, quotes jsonb, platform, community, posted_at, created_at)`; RLS read own; writes by RPC
  `cmo_save_library(p_user, p_run, p_items jsonb)` (service role, from a `sales_scan` run of that user).
- RPC `my_library(p_source text default null)` returning themes with count, this week's count, posts that used them,
  and up to 3 entries each; `library_delete_entry(p_url)` for removal on request (service role).
- pgTAP: ownership, a run of another user refused, counts, the weekly trend.

### - [x] A3. People: status, reply link, reach, DM draft
- `opportunities`: `person_status` (plan's `PersonStatus`, default `found`), `reply_url`, `replied_at`,
  `reach_level`, `reach jsonb`, `dm_draft text`, `nudge_draft text`, `status_at`.
- RPCs (founder): `opportunity_mark_replied(p_id, p_url)` (URL must be on the thread's host), `opportunity_set_status
  (p_id, p_status)`; (service role) `cmo_save_reach(p_user, p_run, p_items)`, `cmo_save_nudge(...)`. Wire the existing
  `opportunity_reply_url` or replace it.
- Allowlist test 182 gets the founder functions. pgTAP for each.

### - [ ] A4. Documents v2
- `strategy`: add `where_they_ask` (list of communities / places) and `this_week` (one line); move `voice` and
  `avoid` to a new `brand` document kind with `voice_samples` (up to 5 texts, 600 chars each), `intro_line`, `avoid`
  (list), `look` (`logo_url`, `colors` (2–4 hex), `font`, `screenshots` (storage paths), `image_styles`).
- `content_strategy` becomes `post_plan` (`topics` from the Library, `channels` among x/linkedin/threads, `rhythm`);
  migrate existing rows (keep old text in a `legacy` field, never drop data); `DOCUMENT_KINDS` updated with a
  migration of `marketing_documents.kind`.
- pgTAP: the migration keeps every old document readable.

### - [ ] A5. Scan cadence and the funnel
- `sales_settings.cadence` (`mwf` default, `weekdays`, `monday`) with `sales_settings_save` extended.
- RPC `my_funnel(p_days int default 7)`: found, replied, answered back, signed up, by source; reads `opportunities`
  statuses and `cmo_draft_outcomes`.

### - [ ] A6. Competitors by URL
RPC `competitor_add(p_url)` (founder) storing name, site, logo URL, price text and offer read by B or C's route (A
gives the table and RPC; reading the site is a route in C5 that calls the existing site reader). Mentions per
competitor per week from `opportunities` text (counted in SQL view `my_competitor_mentions`).

## Requests

- **From B (for A2/A3, what B1's scan sends):** `cmo_save_opportunities` returns a count, not ids, so the scan cannot
  know an opportunity's id. Please key the items of `cmo_save_library` and `cmo_save_reach` by the thread's `url`
  (SQL finds the opportunity of `p_user` with that URL, saved by `p_run`; an unknown URL is skipped, not an error).
  Item shapes B1 will send, as `Store` methods (`types.ts`, `store.ts`, `memory-store.ts`):
  - `saveLibrary(userId, runId, items: { url, summary, theme, quotes: LibraryQuote[] }[]): Promise<number>`: `theme`
    is a name (≤ 80 chars); SQL reuses the user's theme with that name (case-insensitive) or creates it.
  - `libraryThemeNames(userId, limit = 30): Promise<string[]>`: the user's theme names, most used first, so the
    scoring prompt can reuse one.
  - `saveReach(userId, runId, items: { url, level: ReachLevel, reach: ReachCheck }[]): Promise<number>`.
  - On the Reddit rules cache (`subreddit_rules`, `SubredditRule`): one more field, `no_dms boolean` (default false),
    saved by `saveSubredditRule`. The rules reader already reads each community; it will also say when the rules forbid
    DMs or soliciting, so `dmAllowed` reads the community's rule as the plan asks.

- **From B (B5, Today):** `today.ts` now takes `TodayCard.score` / `TodayCard.postedAt` (reply cards) and
  `TodayInput.followUps: TodayFollowUp[]`. `lib/cmo/today-input.ts` is no session's file; with A3, please fill them
  there (or say I may): `score` from the reply card's snapshot, `postedAt` from its opportunity's `posted_at`, and
  `followUps` from opportunities with `person_status = 'answered_back'` (status `answered_back`, `at` = `status_at`)
  or `replied` with `replied_at` older than `NUDGE_AFTER_DAYS` and a nudge drafted (`no_answer`, `approvalId` = the
  nudge's card if it has one).

- **From B (B3, posts from the Library):** `plan_week` and `post_draft` run under the service role, so `my_library`
  (founder) does not reach them. Please add a store method (any RPC name):
  `libraryTopThemes(userId, days = 14, limit = 5): Promise<{ id, name, count, entries: { opportunityId, summary,
  platform, community, postedAt, quotes }[] }[]>`: themes with entries posted (or saved) in the last `days`, most
  entries first, up to 5 entries each, newest first. B3 writes `content_items.body.sources: PostSource[]` from these
  (A2 note). A memory-store twin that reads `mem.library` is enough for the evals; it needs the opportunity id, so
  the memory Library may key lines by url and look the id up in `opps`.

- **From B (B6, re-reads; with A3):** `checkReply` now returns `answeredBack` and reads Threads. Please, in SQL:
  `cmo_reply_outcomes_due` returns Threads too (`p.platform in ('reddit', 'hn', 'threads')`) and gives the new
  `reply_url` as `outcome_url` when set (`coalesce(p.reply_url, o.outcome_url)`); `saveReplyOutcome` takes an
  optional `answeredBack` (or SQL reads `p_replies > 0` on a `found` outcome) and sets `person_status =
  'answered_back'`, `status_at = now()` when the person is still `found` or `replied` (never moving a later status
  back). The memory store does the same, so the check and the evals see it.
