-- Web hardening round 3, A9: the checks Supabase's advisors run, as pgTAP, so a new migration that brings a
-- finding back fails CI instead of showing up on production's advisor page weeks later.
--
--   auth_rls_initplan                  a policy calls auth.uid()/auth.jwt()/auth.role()/current_setting() per row
--   function_search_path_mutable       a public function has no search_path setting
--   trigger functions                  callable through /rest/v1/rpc by anon or authenticated
--   anon_security_definer_function_executable
--                                      a security definer function anon can call, other than the one meant for it
--
-- Each test lists the offenders, so the failure says what to fix.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

-- A wrapped call deparses as "( SELECT auth.uid() AS uid)", or "( SELECT (auth.jwt() ->> 'role'::text))" when the
-- select holds an expression, and is evaluated once per query (an initplan). Strip every wrapped call; anything left
-- that still calls these functions runs once per row. `storage` too: our migrations put the file policies there.
select is_empty(
  $$
  select schemaname || '.' || tablename || ' / ' || policyname
  from pg_policies
  where schemaname in ('public', 'storage')
    and regexp_replace(regexp_replace(
          coalesce(qual, '') || ' ' || coalesce(with_check, ''),
          '\( SELECT (auth\.[a-z_]+\(\)|current_setting\([^()]*\)) AS [a-z_]+\)', '', 'g'),
          '\( SELECT \((auth\.[a-z_]+\(\)|current_setting\([^()]*\))[^()]*\)\)', '', 'g'
        ) ~ '(auth\.[a-z_]+\(|current_setting\()'
  order by 1
  $$,
  'every policy wraps auth.*() and current_setting() in (select ...): fix with (select auth.uid())'
);

-- Functions an extension installs are not ours to set.
select is_empty(
  $$
  select p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  order by 1
  $$,
  'every public function sets search_path: add "set search_path = public" (or '''' for constant bodies)'
);

-- Postgres checks EXECUTE on a trigger function only when the trigger is created, so revoking costs nothing.
select is_empty(
  $$
  select p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  order by 1
  $$,
  'no trigger function is callable by anon or authenticated: revoke execute from public, anon, authenticated'
);

-- email_unsubscribe is the email footer's unsubscribe link, so a signed-out reader must reach it. It is safe for
-- anon: it changes only the row whose unsubscribe_token (a random, unique uuid) matches, only turns the digest
-- off, and returns true whether or not a row matched, so it neither reveals nor touches anyone else's settings.
select is_empty(
  $$
  select p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    and p.oid <> 'public.email_unsubscribe(uuid)'::regprocedure
  order by 1
  $$,
  'no security definer function is callable by anon except email_unsubscribe'
);

select * from finish();
rollback;
