# Session B: published at the first platform; photo draft cleanup

Plan: [`../2026-11-13-core-drafts-followups-plan.md`](../2026-11-13-core-drafts-followups-plan.md) Tasks 2 and 3.
Rules: [`README.md`](README.md) (numbers, the SQL functions you own).

**Owns:** `supabase/migrations/20270121010000_post_published_first.sql`, `20270121020000_photo_draft_cleanup.sql`,
`supabase/tests/309_*`, `310_*`, the changed cases of `308_review_fixes.test.sql`, one call in
`apps/web/app/api/cron/cleanup/route.ts`.

- [x] Task 2: a post is `published` when its first platform posts (decision F1). Start from the latest definition of
  each function (`supabase/schema/current.sql`), change only the lines the plan names.
- [x] Task 3: photo drafts are cleaned up (decision F3).

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

- Task 3: `310_photo_draft_cleanup` 20/20 (the two functions do not exist before it). The full suite was run again
  on a fresh database with every migration in file order, and the dump is the same. `npx tsx lib/cleanup.check.ts`
  fails without the `BUCKETS` fix ("the cleanup cron deletes from photos") and passes with it; `npx tsc --noEmit` in
  `apps/web` passes. Not run: `npm run check:contracts` in full and `npm run build`; CI runs them.
- Beyond the plan, in Task 3: `BUCKETS` in `apps/web/lib/storage.ts` had no `photos`. The cleanup cron skipped every
  `photos` row of `storage_deletions` and got the same rows back on each loop until its deadline, so no photo was ever
  deleted (the unpaid-account purge queues photos too). Without this fix Task 3 would delete nothing.
- Choices in Task 3: a save refuses a photo already queued for deletion ("A photo is missing. Upload it again."),
  rather than taking it out of the queue, because the queue also holds an account purge's rows. A draft with a photo
  uploaded within `p_days` is not swept, since an upload does not touch the draft's row. `photo_post_create` now locks
  the draft row, so a post scheduled in another tab at the same moment is neither emptied nor released.
- Choice in Task 2: a published post asks for a new time again only when one of its slots posted, not just when it
  has a slot. A post marked posted by hand on its card ("I posted it") is not scheduled again by a stale Retry card.

## Seen, not mine

- C (Task 4): `212_p3_writer_orders` test 3 (`cmo_job_daily_limit('write_slides')` is 10) and
  `250_cmo_review_budget_gate` (`cmo_enqueue(..., 'write_slides', ...)` → "Unknown task.") fail once
  `20270121030000_drop_write_slides` is applied. Both files assert the old rule.
- A (Task 1): `312_core_draft_flow` still marks its F1 assertion `todo_start('needs 309')`; 309 is pushed, so it can
  become a plain assertion (it passes here).
