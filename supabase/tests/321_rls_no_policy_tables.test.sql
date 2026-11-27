-- Web hardening round 3, A8: the tables with RLS on and no policy, as one fixed list (advisor lint
-- rls_enabled_no_policy). No signed-in user reads or writes them; only the service role (webhooks, crons, the
-- worker, the CMO runner) and security definer functions do. Checked 2026-11-17: the app reaches them only through
-- lib/supabase/admin.ts (zernio_receipts in the Zernio webhook; rate_limits, storage_deletions and
-- upload_reservations in contract.check.ts), the engine not at all.
--
-- A new table with RLS and no policy fails here until it is added on purpose. A table that should be readable by
-- its owner needs a policy instead.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(3);

create temp table intended (name text primary key) on commit drop;
insert into intended values
  ('account_deletions'),  -- wave 4 A2: the purge log, service role and its definer functions only
  ('signup_outcomes'),  -- launch measurement: anonymous outcomes of deleted accounts, written by the purge, read by the owner funnel
  ('agent_model_prices'),
  ('app_owners'),
  ('creem_customers'),
  ('creem_subscriptions'),
  ('creem_transactions'),
  ('creem_webhook_receipts'),
  ('legacy_photo_posts'),  -- wave 4b A3: deleted photo posts, kept for support only
  ('mcp_confirms'),
  ('orphan_scan_cursors'),
  ('product_events'),
  ('provider_prices'),
  ('provider_spend_cap'),
  ('provider_usage'),
  ('rate_limits'),
  ('storage_deletions'),
  ('upload_reservations'),
  ('worker_draft_initializations'),
  ('worker_operations'),
  ('write_budget_ledger'),
  ('x_news_stories'),  -- Part B1 (2026-11-27): X News snapshots, the snapshot cron and the CMO runner only
  ('zernio_receipts');

create temp table actual on commit drop as
select c.relname::text as name
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid);

select is_empty(
  $$ select name from actual except select name from intended order by 1 $$,
  'no table has RLS and no policy without an entry here'
);
select is_empty(
  $$ select name from intended except select name from actual order by 1 $$,
  'every entry here still has RLS and no policy (drop stale entries)'
);

-- With no policy RLS already hides every row, but TRUNCATE ignores RLS and an old default grant is one policy
-- away from a leak. anon and authenticated hold nothing on these tables (20270127010000 revoked the last three).
select is_empty(
  $$
  select i.name || ' ' || r.role || ' ' || p.priv
  from intended i
  cross join (values ('anon'), ('authenticated')) r(role)
  cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
  where has_table_privilege(r.role, ('public.' || i.name)::regclass, p.priv)
     -- A column grant does not show in has_table_privilege.
     or (p.priv in ('select', 'insert', 'update', 'references')
         and has_any_column_privilege(r.role, ('public.' || i.name)::regclass, p.priv))
  order by 1
  $$,
  'anon and authenticated hold no privilege on a service-role-only table'
);

select * from finish();
rollback;
