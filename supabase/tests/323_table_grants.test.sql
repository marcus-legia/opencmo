-- Web hardening round 4, session A: the exact table rights anon and authenticated hold in `public`.
-- Migration 20270129010000_table_grants revoked Supabase's old default grants and gave back only what the app
-- reads (its header lists the file that proves each row). Every write goes through a SECURITY DEFINER RPC, which
-- needs no grant here.
--
-- A grant that is not listed fails this test: a table, view or sequence a migration creates starts with nothing
-- for anon or authenticated. If a page or the MCP server must read it with a user's session, grant select in the
-- migration and add the row here. A listed grant that is missing fails too: the app would get
-- `permission denied` on a read it relies on.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

create temporary table expected (obj text, grantee text, privilege text);
insert into expected values
    ('account_metrics', 'authenticated', 'SELECT'),
    ('agent_messages', 'authenticated', 'SELECT'),
    ('agent_sessions', 'authenticated', 'SELECT'),
    ('agent_tool_calls', 'authenticated', 'SELECT'),
    ('agent_turn_ratings', 'authenticated', 'SELECT'),
    ('agent_turns', 'authenticated', 'SELECT'),
    ('agent_usage', 'authenticated', 'SELECT'),
    ('ai_models', 'authenticated', 'SELECT'),
    ('api_keys.created_at', 'authenticated', 'SELECT'),
    ('api_keys.id', 'authenticated', 'SELECT'),
    ('api_keys.last_used_at', 'authenticated', 'SELECT'),
    ('api_keys.name', 'authenticated', 'SELECT'),
    ('api_keys.prefix', 'authenticated', 'SELECT'),
    ('api_keys.revoked_at', 'authenticated', 'SELECT'),
    ('api_keys.user_id', 'authenticated', 'SELECT'),
    ('approvals', 'authenticated', 'SELECT'),
    ('artifacts', 'authenticated', 'SELECT'),
    ('best_slots', 'authenticated', 'SELECT'),
    ('billing_catalog', 'anon', 'SELECT'),
    ('billing_catalog', 'authenticated', 'SELECT'),
    ('brand_kits', 'authenticated', 'SELECT'),
    ('clips', 'authenticated', 'SELECT'),
    ('cmo_corrections', 'authenticated', 'SELECT'),
    ('cmo_draft_outcomes', 'authenticated', 'SELECT'),
    ('cmo_draft_ratings', 'authenticated', 'SELECT'),
    ('cmo_goals', 'authenticated', 'SELECT'),
    ('cmo_insights', 'authenticated', 'SELECT'),
    ('cmo_lessons', 'authenticated', 'SELECT'),
    ('cmo_memories', 'authenticated', 'SELECT'),
    ('cmo_runs', 'authenticated', 'SELECT'),
    ('cmo_voice_events', 'authenticated', 'SELECT'),
    ('content_items', 'authenticated', 'SELECT'),
    ('credit_ledger', 'authenticated', 'SELECT'),
    ('credit_orders', 'authenticated', 'SELECT'),
    ('deliverables', 'authenticated', 'SELECT'),
    ('editor_projects', 'authenticated', 'SELECT'),
    ('editor_revisions', 'authenticated', 'SELECT'),
    ('editor_skills', 'authenticated', 'SELECT'),
    ('editor_transcripts', 'authenticated', 'SELECT'),
    ('generations', 'authenticated', 'SELECT'),
    ('jobs', 'authenticated', 'SELECT'),
    ('library_entries', 'authenticated', 'SELECT'),
    ('library_themes', 'authenticated', 'SELECT'),
    ('competitors', 'authenticated', 'SELECT'),
    ('my_competitor_mentions', 'authenticated', 'SELECT'),
    ('marketing_documents', 'authenticated', 'SELECT'),
    ('marketing_documents_latest', 'authenticated', 'SELECT'),
    ('mcp_grants', 'authenticated', 'SELECT'),
    ('media_assets', 'authenticated', 'SELECT'),
    ('media_transcripts', 'authenticated', 'SELECT'),
    ('notify_settings', 'authenticated', 'SELECT'),
    ('opportunities', 'authenticated', 'SELECT'),
    ('page_captures', 'authenticated', 'SELECT'),
    ('photo_posts', 'authenticated', 'SELECT'),
    ('post_metrics', 'authenticated', 'SELECT'),
    ('post_variants', 'authenticated', 'SELECT'),
    ('profiles', 'authenticated', 'SELECT'),
    ('sales_settings', 'authenticated', 'SELECT'),
    ('schedule_slots', 'authenticated', 'SELECT'),
    ('short_batches', 'authenticated', 'SELECT'),
    ('shorts', 'authenticated', 'SELECT'),
    ('social_accounts', 'authenticated', 'SELECT'),
    ('studio_steps', 'authenticated', 'SELECT'),
    ('tasks', 'authenticated', 'SELECT'),
    ('work_order_events', 'authenticated', 'SELECT'),
    ('work_orders', 'authenticated', 'SELECT'),
    ('zernio_profiles', 'authenticated', 'SELECT');

-- Table, view, sequence and column ACLs; grantee 0 is PUBLIC, which every role inherits.
create temporary table actual as
  with acl as (
    select c.relname::text as obj, a.grantee, a.privilege_type
      from pg_class c, aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    union all
    select c.relname || '.' || att.attname, a.grantee, a.privilege_type
      from pg_class c
      join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped,
           aclexplode(att.attacl) a
     where c.relnamespace = 'public'::regnamespace
  )
  select obj, case when grantee = 0 then 'PUBLIC' else grantee::regrole::text end as grantee, privilege_type as privilege
    from acl
   where grantee = 0 or grantee in ('anon'::regrole, 'authenticated'::regrole);

select is(
  (select string_agg(format('%s to %s on %s', privilege, grantee, obj), '; ' order by obj, grantee, privilege)
     from (select * from actual except select * from expected) extra),
  null,
  'no table right beyond the list (grant it in the migration and add it here)'
);

select is(
  (select string_agg(format('%s to %s on %s', privilege, grantee, obj), '; ' order by obj, grantee, privilege)
     from (select * from expected except select * from actual) missing),
  null,
  'every listed right exists (the app reads it with a user''s session)'
);

select is(
  (select count(*)::int from actual where grantee = 'anon'),
  1,
  'anon reads one table: the billing catalogue (landing prices, lib/ops/health.ts probe)'
);

-- Default privileges of the role that runs our migrations: a new table or sequence starts with nothing for them.
-- Not covered: supabase_admin's own defaults in public still grant everything to both roles, and postgres cannot
-- change them (not a member). They apply only to objects supabase_admin creates (an extension installed into
-- public, a dashboard action); the first two assertions catch such an object whenever it exists where this runs.
select is(
  (select string_agg(format('%s %s', d.defaclobjtype, a.grantee::regrole), ', ')
     from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclnamespace = 'public'::regnamespace
      and d.defaclrole = 'postgres'::regrole
      and d.defaclobjtype in ('r', 'S')
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole)),
  null,
  'tables and sequences postgres creates in public grant nothing to anon or authenticated'
);

-- The proof the default holds: a table made now grants nothing to either role.
create table public.zz_grants_probe (id int);
select ok(
  not has_table_privilege('anon', 'public.zz_grants_probe', 'select')
  and not has_table_privilege('authenticated', 'public.zz_grants_probe', 'select')
  and not has_table_privilege('authenticated', 'public.zz_grants_probe', 'insert'),
  'a new table is closed to anon and authenticated'
);

select * from finish();
rollback;
