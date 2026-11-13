# Session B: published at the first platform; photo draft cleanup

Plan: [`../2026-11-13-core-drafts-followups-plan.md`](../2026-11-13-core-drafts-followups-plan.md) Tasks 2 and 3.
Rules: [`README.md`](README.md) (numbers, the SQL functions you own).

**Owns:** `supabase/migrations/20270121010000_post_published_first.sql`, `20270121020000_photo_draft_cleanup.sql`,
`supabase/tests/309_*`, `310_*`, the changed cases of `308_review_fixes.test.sql`, one call in
`apps/web/app/api/cron/cleanup/route.ts`.

- [ ] Task 2: a post is `published` when its first platform posts (decision F1). Start from the latest definition of
  each function (`supabase/schema/current.sql`), change only the lines the plan names.
- [ ] Task 3: photo drafts are cleaned up (decision F3).

Read `.claude/skills/supabase-migrations` first. Refunds and deletions are the two places a mistake costs a founder:
a photo of a `scheduled` post must never reach `storage_deletions`.

## What I ran, what I could not

## Seen, not mine
