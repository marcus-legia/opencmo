# Security review follow-ups (2026-10-21): the checklist for a local session

The security review of #93 produced two fix PRs. Both were written in a cloud session, where the owner could not
deploy or reach production. This is the work left for a laptop, in order. The lessons from the review are skills in
`.claude/skills/` (`security-review-checklist` points to the others).

| PR | Fixes |
|---|---|
| [#94](https://github.com/marcus-legia/opencmo/pull/94) | A shared LLM key (`GROQ_API_KEY`) could be sent to another vendor's endpoint: through an agent's own `CMO_AGENT_<ID>_BASE_URL`, and through the `compat or groq` fallback in the registry and worker moderation. |
| [#95](https://github.com/marcus-legia/opencmo/pull/95) | The master's fallback full encode peaked at 4.1 GB on an 8K source (4 GB container, 2 GB budget); now capped at 3840 px and 4 threads (1.2 GB). Plus `20261221100000_video_pack_leftovers.sql`: production applied `20261220090000` before its refund and video-pack job lines were added. |

## 1. Merge #94, then #95

- Wait for green CI on each. #95's pgTAP run in the cloud used a hand-built database (no GoTrue), so **CI's run is the
  real one**; read its `supabase test db` step.
- Before merging #94: check that no production env points `OPENAI_COMPAT_BASE_URL` or any `CMO_AGENT_*_BASE_URL` at a
  non-Groq endpoint while only `GROQ_API_KEY` is set, on Vercel, `opencmo` and `opencmo-mcp`. Such an agent stops after
  #94 (it fails closed instead of leaking the key). Groq only, the current setup, is not affected.

## 2. Deploy

- Web: Vercel deploys on merge.
- Worker: `cd packages/engine && modal deploy modal_app.py` (#94's moderation key pairing, #95's encode cap). Also
  `modal deploy mcp_app.py` if `opencmo-mcp` uses moderation.
- Database: `supabase db push` applies `20261221100000_video_pack_leftovers.sql`. It is a no-op where nothing was left
  behind, and safe to run again.

## 3. Check production for holds the migration cannot refund

Link jobs and video-pack runs deleted **while in flight** by `20261220090000` lost their row, so SQL cannot tell their
hold from a finished charge. The migration's header records none in flight when the removal shipped. Confirm it
(read-only, Supabase SQL editor):

```sql
select l.ref_kind, l.ref_id, l.user_id, -sum(l.delta) as held,
       min(l.created_at) as first_row, array_agg(distinct l.reason) as reasons
from public.credit_ledger l
where l.user_id is not null
  and ((l.ref_kind = 'job' and not exists (select 1 from public.jobs j where j.id = l.ref_id))
    or (l.ref_kind = 'cmo_run' and not exists (select 1 from public.cmo_runs r where r.id = l.ref_id)))
group by 1, 2, 3
having -sum(l.delta) > 0
order by first_row;
```

A row whose reasons are only `Hold for new job`, `Hold for retry` or `CMO hold`, first written on or before
2026-10-20, is a candidate. Users who delete finished jobs leave the same pattern, so decide row by row, then refund
with `select public.credit_refund('<user_id>', '<ref_kind>', '<ref_id>', 'Refund: link imports were removed');`.

## 4. Explicit table grants (deadline 2026-10-30)

From 2026-10-30, Supabase stops granting Data API access to **new** tables in `public` automatically. Existing tables
keep their grants. What breaks:

- any table a future migration creates without its own `grant` is unreachable from supabase-js, PostgREST and the
  worker's `/rest/v1` ("permission denied");
- rebuilding the schema from migrations (a new project, a preview branch, `supabase db reset` once the CLI adopts the
  change) leaves **every** table without grants. The web reads 42 tables through `supabase.from(...)` and the worker
  writes through the service role, so the whole app stops.

Our migrations rely on the old default (all privileges to `anon`, `authenticated`, `service_role`) and then `revoke`
from it in about 30 places; about 10 migrations grant explicitly. So the grants must be **generated from the real
state, never written by hand**, or a revoke gets lost and a table opens up.

One new migration, `<timestamp>_explicit_table_grants.sql`:

1. `npm run db:reset` on the pinned CLI (2.117.0). It still applies the old default, so the local grants match
   production.
2. Generate the statements:

   ```sql
   select format('grant %s on public.%I to %I;', string_agg(privilege_type, ', ' order by privilege_type),
                 table_name, grantee)
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
   group by table_name, grantee
   order by table_name, grantee;
   ```

   Also cover sequences (`select relname from pg_class where relkind = 'S' and relnamespace = 'public'::regnamespace`,
   with `has_sequence_privilege` per role), since the change may apply to them too.
3. Run the same query in production's SQL editor. **The two outputs must match**; if they differ, production
   drifted, so stop and find out why before writing anything.
4. Paste the output into the migration, then add
   `alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;` and the
   same for sequences. From this migration on, local and CI behave like Supabase after 2026-10-30, so a migration
   that forgets its grants fails tests here instead of in production.
5. pgTAP test (`supabase/tests/19x_explicit_table_grants.test.sql`):
   - every `public` table and view has `service_role` privileges;
   - `authenticated` has `select` on each table the web reads (`grep -rhoE '\.from\("[a-z_]+"\)' apps/web`);
   - the tables revoked on purpose stay closed (`api_keys` select, `mcp_grants`, `polar_*`, `storage_deletions`,
     `upload_reservations`…);
   - a table created inside the test gets no privileges by default.
6. `scripts/dump-schema.sh`, then `npm run db:reset && npm run db:test`, `npm run typecheck && npm run build`,
   `cd apps/web && npm run check:contracts && npm run test:e2e`.
7. Open the PR, merge, `supabase db push` **before 2026-10-30**. On production every statement is a no-op except the
   default-privileges change.

From then on, every migration that creates a table grants in the same file (the `supabase-migrations` skill).

## 5. Optional: look tools spend database work before the hourly cap

`apps/web/lib/mcp/look.ts:94-101` runs `clipContext` and `ensureProject` (which can create the editor project) before
`rate_limit_hit('mcp_look', …)`, so a caller over its 60 an hour still causes those writes. Bounded by the 600-an-hour
`mcp` bucket. Fix: `clipContext` (ownership), then the cap, then `ensureProject`; a wrong id still doesn't spend a
look.

## 6. Measure the upload pipeline

CLAUDE.md still has no time budget for processing an upload. Run a long upload (10–15 min, 4K) through
`process_job` under `/usr/bin/time -v`, record peak RSS and wall time, and set the budget in CLAUDE.md.
