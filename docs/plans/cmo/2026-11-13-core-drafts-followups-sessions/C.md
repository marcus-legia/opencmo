# Session C: no slideshow to write; ready for real accounts

Plan: [`../2026-11-13-core-drafts-followups-plan.md`](../2026-11-13-core-drafts-followups-plan.md) Tasks 4 and 5.
Rules: [`README.md`](README.md).

**Owns:** the Writer and agent files Task 4 lists, `packages/contracts/capabilities.json`,
`supabase/migrations/20270121030000_drop_write_slides.sql`, `supabase/tests/311_*`,
`apps/web/lib/departments/publish/zernio.ts`, `split.ts` and their checks,
`docs/plans/cmo/2026-11-13-real-account-checklist.md` (new).

- [x] Task 4: remove "Write a slideshow" and the `write_slides` job (decision F2). Keep everything that opens or posts
  a slideshow already made.
- [ ] Task 5: Zernio's documents read and quoted, code fixed where it differs, the owner's checklist written.

Task 4 touches a refund: a queued `write_slides` run gets its hold back exactly once (`credit_refund`, only where the
run is `queued` or `running`). Task 5 changes code only on evidence from the documents; a guess goes in the checklist
as "to confirm on a real account", not into `zernio.ts`.

## What I ran, what I could not

Task 4:
- No Docker in this container, so no Supabase stack. I ran Postgres 16 (from the OS) with stub roles, `auth.users`,
  `auth.uid()`, a minimal `storage` schema and tiny stand-ins for pgTAP's `plan/is/ok/throws_ok/finish`, loaded
  `supabase/schema/current.sql` into it, then applied `20270121030000_drop_write_slides.sql`.
- `311_drop_write_slides`: run before the migration (fails: `cmo_drop_write_slides()` does not exist) and after it
  (13/13 ok). The real pgTAP run is CI's `database (Supabase)` job.
- `current.sql`: a `pg_dump` diff of that database before and after the migration, applied to the file (not a full
  `scripts/dump-schema.sh` run against every migration).
- `npx tsc --noEmit -p apps/web`: clean. `npm run check:contracts` (apps/web): green, with `writer.check`,
  `registry.check`, `no-ai-slop.check`, `capabilities.check`, `jobs.check`, `mcp.check` and the eval coverage in it.
- Not run: Playwright (no stack). No e2e test used the Slideshow chip.

## Zernio's documents (URL, date read, the words)

## Seen, not mine
