---
name: supabase-migrations
description: Use before writing or changing anything under supabase/migrations/ or supabase/tests/, or any SQL that moves credits, creates a table, or cleans up data. Covers never editing an applied migration, explicit grants on new tables, pgTAP, the schema dump, refunds, and testing when the Supabase CLI cannot start.
---

# Supabase migrations

## Never edit a migration that has merged

Production may already have applied it, and `supabase db push` never runs a version twice. An edit reaches fresh
databases and CI but not production, so they silently diverge.

Incident: `20261220090000_remove_clipping.sql` got refund lines and a video-pack job delete in #93, a day after #90
merged it. Production had applied the #90 version, so it deleted video-pack project rows but left their jobs, and
the refunds never ran. #95 added `20261221100000_video_pack_leftovers.sql` to finish the job.

- A migration is editable only while its PR is open. After merge, write a new one.
- Make it idempotent and a no-op where the earlier version did run (`if exists`, `create or replace`,
  `where not exists`).
- To know which version production ran, compare the file at each merge commit
  (`git log --format='%h %cI' -- <file>`, `git merge-base --is-ancestor`). Ask the owner to run
  `select version from supabase_migrations.schema_migrations where version = '<ts>';` when it matters.

## Every new table grants in the same migration

From 2026-10-30, Supabase no longer grants Data API access on new `public` tables. A table without grants is
unreachable from supabase-js, PostgREST, GraphQL and the worker's `/rest/v1`.

```sql
grant select on public.<table> to anon;                                        -- only if anon must read it
grant select, insert, update, delete on public.<table> to authenticated;       -- trim to what RLS and RPCs need
grant select, insert, update, delete on public.<table> to service_role;
```

Grant the least each role needs. Most of our tables give `authenticated` `select` only (writes go through RPCs, web
rule 1). Assert the grants in the table's pgTAP test.

## Every migration has a pgTAP test

`supabase/tests/<next number>_<name>.test.sql`, `begin; … select plan(n); … select * from finish(); rollback;`.

- A data migration can't be tested on a fresh database (there's no data). Put the logic in a function the migration
  calls, `revoke all … from public, anon, authenticated`, and have the test seed the bad state and call it. Assert
  the rerun is a no-op.
- Test as a user with `set local role authenticated; set local request.jwt.claims = '{"sub":"…"}';`.

## After the migration

- `scripts/dump-schema.sh` regenerates `supabase/schema/current.sql`. The diff should show only your change.
- `npm run db:reset && npm run db:test`, one heavy suite at a time.
- English in every `raise exception`: it reaches the user verbatim.

## Money

Credits move only through `credit_hold`, `credit_settle`, `credit_refund`, `credit_held` and `refund_job`. Refund
only where current state proves the work was in flight (a job row with `status in ('queued', 'running')`).

- `credit_ledger` rows outlive their job or run (no foreign key on `ref_id`).
- A settle at exactly the held amount writes no row, and users delete finished jobs. So an orphan hold **can't** tell
  in-flight from finished work. Never refund orphans in bulk; list them read-only and decide row by row.

## Running the database locally

Use the pinned CLI from CI (`supabase/setup-cli`, version 2.117.0), never `npx supabase`.

If the CLI can't pull its images (registry rate limits or blocked hosts in a cloud container), test against the
pinned Postgres image directly:

1. `docker run -d --name pgt -e POSTGRES_PASSWORD=postgres supabase/postgres:<version from CI>`
2. As `supabase_admin`, create a minimal `storage` schema (`buckets`, `objects` with `bucket_id`, `name`, `owner`,
   `metadata`, `path_tokens`; `storage.foldername(text)`), then hand both tables to `postgres`. Migrations need it
   because no storage-api runs.
3. Apply every migration in order as `postgres` with `psql -v ON_ERROR_STOP=1 -1` (one transaction each, so a failure
   leaves nothing half-applied).
4. Run the test files with `psql` and grep for `not ok|ERROR`.

There's no GoTrue, so `auth.uid()` ignores the test JWT and many files fail with "Not signed in". Run the suite with
and without your change and compare the failing sets. Say in the PR that CI's run is the authoritative one.
