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

### - [ ] A2. Library tables
- `library_themes (id, user_id, name, created_at)`, `library_entries (opportunity_id pk → opportunities, user_id,
  theme_id, summary, quotes jsonb, platform, community, posted_at, created_at)`; RLS read own; writes by RPC
  `cmo_save_library(p_user, p_run, p_items jsonb)` (service role, from a `sales_scan` run of that user).
- RPC `my_library(p_source text default null)` returning themes with count, this week's count, posts that used them,
  and up to 3 entries each; `library_delete_entry(p_url)` for removal on request (service role).
- pgTAP: ownership, a run of another user refused, counts, the weekly trend.

### - [ ] A3. People: status, reply link, reach, DM draft
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

(none yet)
