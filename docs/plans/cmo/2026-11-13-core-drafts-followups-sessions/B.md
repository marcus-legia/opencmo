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

## Closing round (owner's ask, 2026-11-13): every session finished, the whole branch reviewed

Run on a full local Supabase stack this time (CLI 2.117.0 with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`, since
AWS ECR is blocked here): `supabase db reset` + `supabase test db` → 205 files, 3,449 tests, PASS. `npm run
check:contracts` green, `tsc --noEmit` clean, `npx tsx e2e/run.ts ui-v2-core-drafts ui-v2-slides` 8/8,
`p6-acceptance.e2e.ts` passed. `supabase/schema/current.sql` dumped by `scripts/dump-schema.sh` against that stack.

Left open by the sessions, now done: `112`, `212`, `250` brought up to D6 and F2; `312`'s F1 TODO made plain; A's
Steps 3 and 4 run (see `A.md`).

`/code-review` (high) of the branch against #204's, ten findings, all fixed:

1. `hardCut` summed per-grapheme sizes, so a link glued to a long word came out as a 293-character X part. Each piece
   is now measured whole.
2. `xLength` counted bare domains as letters and every code point as 1. It now follows twitter-text's v3 weights
   (CJK, "…", "→", Vietnamese tone marks are 2) and counts a bare domain as at least 23.
3. The thread chips on a schedule card counted code points; an X thread now shows X's count.
4. Drafts cancelled before F3 kept their photos: `photo_draft_release` takes a cancelled post, and the migration
   releases those once.
5. A closed draft answered "already scheduled": save and schedule now say "This draft was closed. Start a new photo
   post."
6. Writer's `checkPost` counted X by code point: it takes the larger of that and `xLength`, so the 280-code-point
   thread schemas still hold.
7. `Intl.Segmenter` was built on every call: built once; the card memoises `chainFor`.
8. `split.ts` needs Segmenter and a lookbehind in client code: a code-point fallback, and no lookbehind.
9. `writer.html` and `studio.html` were not changed with their markdown twins: they are now.
10. The F1 schedulable rule was copied in two functions: one helper, `post_schedules`.

Storage (owner, 2026-11-13): uploads stay on Supabase Storage, the image buckets included, and move to DigitalOcean
storage later this week. Each upload entry point and `BUCKETS` carry a `TODO(storage)` line; nothing else changed.

## Seen, not mine

- C (Task 4): `212_p3_writer_orders` test 3 (`cmo_job_daily_limit('write_slides')` is 10) and
  `250_cmo_review_budget_gate` (`cmo_enqueue(..., 'write_slides', ...)` → "Unknown task.") fail once
  `20270121030000_drop_write_slides` is applied. Both files assert the old rule.
- A (Task 1): `312_core_draft_flow` still marks its F1 assertion `todo_start('needs 309')`; 309 is pushed, so it can
  become a plain assertion (it passes here).
