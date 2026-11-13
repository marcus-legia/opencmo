# Session B: published at the first platform; photo draft cleanup

Plan: [`../2026-11-13-core-drafts-followups-plan.md`](../2026-11-13-core-drafts-followups-plan.md) Tasks 2 and 3.
Rules: [`README.md`](README.md) (numbers, the SQL functions you own).

**Owns:** `supabase/migrations/20270121010000_post_published_first.sql`, `20270121020000_photo_draft_cleanup.sql`,
`supabase/tests/309_*`, `310_*`, the changed cases of `308_review_fixes.test.sql`, one call in
`apps/web/app/api/cron/cleanup/route.ts`.

- [x] Task 2: a post is `published` when its first platform posts (decision F1). Start from the latest definition of
  each function (`supabase/schema/current.sql`), change only the lines the plan names.
- [ ] Task 3: photo drafts are cleaned up (decision F3).

Read `.claude/skills/supabase-migrations` first. Refunds and deletions are the two places a mistake costs a founder:
a photo of a `scheduled` post must never reach `storage_deletions`.

## What I ran, what I could not

The Supabase CLI was not used. pgTAP ran against `supabase/postgres:17.6.1.054` in Docker (no GoTrue, no storage-api):
the image's minimal `storage.buckets` / `storage.objects` got the columns the migrations use, and `auth.uid()` /
`auth.role()` / `auth.jwt()` were redefined to read `request.jwt.claims` as GoTrue's do, so founder-side tests run.
All 224 migrations applied in order (`psql -1 -v ON_ERROR_STOP=1`), then every file of `supabase/tests/`.
`supabase/schema/current.sql` was dumped with that container's `pg_dump` 17 and the pipeline of
`scripts/dump-schema.sh` (the local `pg_dump` is 16); its diff is only this branch's change. CI's
`database (Supabase)` job is the authoritative run.

- Baseline before Task 2: 196 of 201 files pass. Failing with and without my changes: `112_cmo_engine` (tests 32-33),
  `137_g5_api_keys`, `170_mcp_admit`, `297_api_key_owner_banned` (`auth.users.deleted_at` is missing from this image),
  and `098_generations` once (passes on rerun).
- Task 2: `309_post_published_first` 22/22; with the old functions put back it fails (1, 2, 4, 5, …), and `308`'s two
  changed cases fail on the old rule and pass on the new one. Full suite after: the same failing set as the baseline.

## Seen, not mine
