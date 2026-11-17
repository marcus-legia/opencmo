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

- [x] 1. **Read the findings again** (`get_advisors`, `security` and `performance`, project `burxcywnhutuqbysnour`;
  read-only). Compare with `supabase/schema/current.sql`: a finding that does not match our migrations (e.g.
  `rls_auto_enable`) goes to "For the owner", not into a migration.
- [x] 2. **`auth_rls_initplan`, 8 policies** (`jobs`, `clips`, `scene_codes`, `editor_skills`, `editor_feedback`,
  `mcp_grants`, `work_order_usage`, `credit_orders`): recreate each with `(select auth.uid())`, same name, same
  command, same roles. pgTAP proves each still lets the owner read and hides another user's rows (reuse the two-user
  setup of an existing RLS test).
- [x] 3. **`function_search_path_mutable`, 22 functions**: `alter function … set search_path = ''` (or `public` where a
  body uses unqualified names: read each body; most are constant settings like `signup_credits()`). No body change.
- [x] 4. **Trigger and internal functions callable by `anon`/`authenticated`**: revoke `execute` from `public`, `anon`,
  `authenticated` on `handle_new_user`, `refund_media_captions_from_task` and any other function that `returns
  trigger`; take them off 182's allowlist. `email_unsubscribe` is meant for `anon` (the unsubscribe link): confirm it
  checks its token and say so in the test's comment, do not revoke.
- [x] 5. **Foreign keys without an index (39)**: index only those a real query or an `on delete cascade` walks
  (account deletion walks every `user_id`; joins by `run_id`, `job_id`, `order_id`, `turn_id`). For each skipped
  one, one line in the migration's header saying why. Plain `create index if not exists` (a migration runs in a
  transaction, so no `concurrently`; every table is small today: check row counts read-only first and write them in
  the header).
- [x] 6. **`write_budget_ledger` without a primary key**: add one if the rows have a natural key; otherwise a
  `bigint generated always as identity` column. Check how it is written first (`current.sql`) so no insert breaks.
- [x] 7. **Unused indexes (15)**: keep all; write in the migration header that the database is two months old and the
  list is re-read on 2027-01-15. No drop in this round.
- [x] 8. **RLS with no policy (19 tables)**: confirm each is written and read only with the service role (grep the app
  and the worker). One pgTAP (`321_*`) lists them as the intended set, so a new table with RLS and no policy has to be
  added on purpose.
- [x] 9. **The guard, pgTAP `320_*`**: fails when a `public` policy calls `auth.uid()`/`auth.jwt()`/`current_setting()`
  outside a `select`, when a `public` function has no `search_path` setting, or when a trigger function is
  executable by `anon` or `authenticated`. Query the catalogue (`pg_policies`, `pg_proc.proconfig`,
  `has_function_privilege`), the same checks the advisors run.
- [x] 10. `scripts/dump-schema.sh`, `npm run db:reset && npm run db:test` (whole suite, green), then update the
  backlog rows you own (plan, "Shared files").
- [x] 11. **Review**: `/code-review high` on your diff, then the `security-review-checklist` skill. Fix what is
  confirmed. Commit (`git add` your paths only, message ends with the review line), `git pull --rebase`, push.

## Checks before each push

`npm run db:reset && npm run db:test` (whole pgTAP suite), `npm run typecheck` (in case a generated type changed).

## For the owner (write here, do not do)

- Supabase → Authentication → leaked-password protection: on.
- After the merge: `supabase db push` (applies `20270127010000_advisors_clean.sql`), then read the advisors again.
  What should remain: `authenticated_security_definer_function_executable` (our RPC surface, listed in `182_*`),
  `rls_enabled_no_policy` 19 (intended, `321_*`), `unused_index` 15 (kept, re-read 2027-01-15),
  `anon_security_definer_function_executable` for `email_unsubscribe` (meant for anon) and `rls_auto_enable`
  (below), `auth_leaked_password_protection` until the switch above is on. Nothing else.
- `public.rls_auto_enable()` is on production but in none of our migrations (likely created from the dashboard's
  "auto-enable RLS" option): a `security definer` function anon can call through `/rest/v1/rpc/rls_auto_enable`.
  If you created it on purpose, run `revoke execute on function public.rls_auto_enable() from public, anon,
  authenticated;` in the SQL editor (an event trigger does not need EXECUTE). If not, drop it. Read-only check:
  `select pg_get_functiondef('public.rls_auto_enable()'::regprocedure);`

## For the lead

(Lines that belong in `CLAUDE.md` or files A does not own.)

- A touched `supabase/tests/010_rls.test.sql` (not in the plan's list; nobody else owns it): two assertions that
  read `rate_limits` as a user now expect a refusal (42501) instead of an empty result, because the migration
  revoked the table's old default grants. Same intent, stricter.
- Follow-up, not this round: about 40 older `public` tables still carry Supabase's default full grants (TRUNCATE
  included) to `anon` and `authenticated`; RLS is what holds them back. Trimming them to what each table needs is a
  table-by-table job (some pages read as anon); worth an issue.
- `CLAUDE.md` Web rules could say: "a new function sets `search_path`, a trigger function revokes execute, a policy
  uses `(select auth.uid())`; `supabase/tests/320_advisor_guard` fails otherwise."

