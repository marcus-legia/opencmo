# Session A — database

Plan: [`../2026-11-17-web-hardening-round-3-plan.md`](../2026-11-17-web-hardening-round-3-plan.md). Waits on nothing.
Coordinate `db:reset`/`db:test` runs with session C (`SendMessage`), one at a time.

Goal: production's Supabase advisors (security and performance) show only what we keep on purpose, and a pgTAP guard
fails CI when a new migration brings a finding back.

Owns: `supabase/migrations/20270127*` (new), `supabase/tests/319_*`, `320_*`, `321_*` (new),
`supabase/tests/182_authenticated_function_allowlist.test.sql` (all of it except C's one line),
`supabase/schema/current.sql` (regenerated, never hand-edited). Read the `supabase-migrations` skill first: never
edit an applied migration; a new migration changes what is live.

## Todo, in order

- [ ] 1. **Read the findings again** (`get_advisors`, `security` and `performance`, project `burxcywnhutuqbysnour`;
  read-only). Compare with `supabase/schema/current.sql`: a finding that does not match our migrations (e.g.
  `rls_auto_enable`) goes to "For the owner", not into a migration.
- [ ] 2. **`auth_rls_initplan`, 8 policies** (`jobs`, `clips`, `scene_codes`, `editor_skills`, `editor_feedback`,
  `mcp_grants`, `work_order_usage`, `credit_orders`): recreate each with `(select auth.uid())`, same name, same
  command, same roles. pgTAP proves each still lets the owner read and hides another user's rows (reuse the two-user
  setup of an existing RLS test).
- [ ] 3. **`function_search_path_mutable`, 22 functions**: `alter function … set search_path = ''` (or `public` where a
  body uses unqualified names: read each body; most are constant settings like `signup_credits()`). No body change.
- [ ] 4. **Trigger and internal functions callable by `anon`/`authenticated`**: revoke `execute` from `public`, `anon`,
  `authenticated` on `handle_new_user`, `refund_media_captions_from_task` and any other function that `returns
  trigger`; take them off 182's allowlist. `email_unsubscribe` is meant for `anon` (the unsubscribe link): confirm it
  checks its token and say so in the test's comment, do not revoke.
- [ ] 5. **Foreign keys without an index (39)**: index only those a real query or an `on delete cascade` walks
  (account deletion walks every `user_id`; joins by `run_id`, `job_id`, `order_id`, `turn_id`). For each skipped
  one, one line in the migration's header saying why. Plain `create index if not exists` (a migration runs in a
  transaction, so no `concurrently`; every table is small today: check row counts read-only first and write them in
  the header).
- [ ] 6. **`write_budget_ledger` without a primary key**: add one if the rows have a natural key; otherwise a
  `bigint generated always as identity` column. Check how it is written first (`current.sql`) so no insert breaks.
- [ ] 7. **Unused indexes (15)**: keep all; write in the migration header that the database is two months old and the
  list is re-read on 2027-01-15. No drop in this round.
- [ ] 8. **RLS with no policy (19 tables)**: confirm each is written and read only with the service role (grep the app
  and the worker). One pgTAP (`321_*`) lists them as the intended set, so a new table with RLS and no policy has to be
  added on purpose.
- [ ] 9. **The guard, pgTAP `320_*`**: fails when a `public` policy calls `auth.uid()`/`auth.jwt()`/`current_setting()`
  outside a `select`, when a `public` function has no `search_path` setting, or when a trigger function is
  executable by `anon` or `authenticated`. Query the catalogue (`pg_policies`, `pg_proc.proconfig`,
  `has_function_privilege`), the same checks the advisors run.
- [ ] 10. `scripts/dump-schema.sh`, `npm run db:reset && npm run db:test` (whole suite, green), then update the
  backlog rows you own (plan, "Shared files").
- [ ] 11. **Review**: `/code-review high` on your diff, then the `security-review-checklist` skill. Fix what is
  confirmed. Commit (`git add` your paths only, message ends with the review line), `git pull --rebase`, push.

## Checks before each push

`npm run db:reset && npm run db:test` (whole pgTAP suite), `npm run typecheck` (in case a generated type changed).

## For the owner (write here, do not do)

- Supabase → Authentication → leaked-password protection: on.
- After the merge: `supabase db push`, then read the advisors again; the PR description lists what should remain.

## For the lead

(Lines that belong in `CLAUDE.md` or files A does not own.)
