# Session A — table grants

Plan: [`../2026-11-17-web-hardening-round-4-plan.md`](../2026-11-17-web-hardening-round-4-plan.md). Waits on nothing.

Goal: `anon` and `authenticated` hold only the table rights the app really uses, a table created later starts with
none, and pgTAP fails a migration that hands them more. Today RLS is the only guard on about 40 tables that still
carry Supabase's default full grants (round 3, session A, "For the lead").

Read first: the `supabase-migrations` skill, `supabase/migrations/20270127010000_advisors_clean.sql` (how round 3
revoked three tables), `supabase/tests/321_rls_no_policy_tables.test.sql`, CLAUDE.md "Web rules" 1 (every write is an
RPC).

## Todo, in order

- [ ] 1. **Measure.** After `npm run db:reset`, list every grant to `anon` and `authenticated` in `public`: tables,
  views, materialized views and sequences (`information_schema.role_table_grants`, `role_usage_grants`, and
  `pg_default_acl` for the default privileges). Paste the counts into the commit message.
- [ ] 2. **Find what the app uses**, per table and per role. Sources, all of them:
  - `.from("<table>")` with a user's client in `apps/web/**` (server components, route handlers, `lib/**`, browser
    code). The service-role client (`lib/supabase/admin.ts`) needs no grant; skip it.
  - Realtime subscriptions (`postgres_changes`): the subscriber needs `select`.
  - Views: a `security_invoker` view needs the caller's grant on its base tables too.
  - Public pages read as `anon` (landing prices from the billing catalogue, blog, `/r/...`, share pages, anything
    `withApi` lets through unsigned). Check each page that renders signed out.
  - The MCP server (`lib/mcp/`) runs under a short-lived user JWT, so its reads count as `authenticated`.
  - The engine reads with the service role: no grant.
  - Direct writes: Web rule 1 says none, so expect `insert`/`update`/`delete` to be needed nowhere. Grep for
    `.insert(`, `.update(`, `.upsert(`, `.delete(` on a user client; any you find is a finding, not a grant to keep:
    write it under "For the lead" with the file and line.
  Write the result as a table in the migration's header comment: table → `anon` rights, `authenticated` rights, and
  the file that proves each.
- [ ] 3. **Migration `20270129010000_table_grants.sql`**:
  - `revoke all on all tables in schema public from anon, authenticated;` and the same for sequences;
  - grant back exactly what step 2 found (mostly `select` to `authenticated`, a few `select` to `anon`);
  - `alter default privileges` (for the role that runs migrations, and for `supabase_admin` if it holds defaults in
    `public`) so a new table, view or sequence grants nothing to `anon` or `authenticated`. Functions are out of scope
    (they are listed by `182_*`).
  - Do not touch `storage`, `auth`, `realtime` or any schema but `public`.
- [ ] 4. **pgTAP `323_table_grants.test.sql`**: the exact list of (object, role, privilege) that may exist in
  `public` for `anon` and `authenticated`; any other grant fails, with a message that says "grant it in the migration
  and add it here". Check that the default privileges grant nothing to either role. **`324_*`**: for three tables a
  user reads (one per kind: plain table, realtime, view), a signed-in user still reads their own rows, and `anon`
  gets `42501` on a table it no longer has.
- [ ] 5. Fix the existing tests the revoke changes (`010_rls.test.sql` and any other that read as a role): a test that
  read an empty result as a user may now get `42501`. Same intent, stricter. Note each one in the commit.
- [ ] 6. **Prove the app still reads what it needs**: the whole pgTAP suite, then the e2e smoke and the whole `full-v2`
  suite against your local stack (`cd apps/web && npx tsx e2e/run.ts`; v2 with `NEXT_PUBLIC_OPENCMO_UI=v2`), and
  `npm run check:api` (see `apps/web/README.md` for the env it needs). A `permission denied for table` anywhere is a
  missing grant: add it, with the file that proves it, to the migration and to `323_*`.
- [ ] 7. `scripts/dump-schema.sh`, then the backlog's §5 "Least privilege" row.

## Checks before each push

`npm run db:reset && npm run db:test` (whole suite), `npm run typecheck`, the e2e runs of item 6 (paste pass counts).

## For B

(B writes here the grants its new objects need; A adds them to `323_*` before its last push, or the lead does.)

## For the owner (write here, do not do)

- After the merge: `supabase db push` **before** the web deploy, then open the landing page signed out and the
  dashboard signed in, and read the Supabase logs for `permission denied` for a day.

## For the lead

- `CLAUDE.md` "Web rules" line to add: "A new table, view or sequence grants nothing to `anon` or `authenticated`;
  grant what the app reads in the same migration and add it to `supabase/tests/323_table_grants`."
