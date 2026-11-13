-- 20270120010000: schema-wide invariants. They run on the whole schema, so a future migration that adds a table
-- without RLS, a foreign key without an index, or a grant wider than the RPCs need fails here.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

select is_empty($$
  select c.relname::text from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
$$, 'every public table has row level security');

-- A delete on the parent scans the whole child table without one. Add the index in the same migration as the key.
select is_empty($$
  select c.conrelid::regclass::text || '.' || c.conname from pg_constraint c
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and c.conname not in ('generations_model_fkey')
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
$$, 'every foreign key has an index on its first column');

select is_empty($$
  select indrelid::regclass::text from pg_index
  where indrelid::regclass::text not like 'pg\_%'
  group by indrelid, indkey, indclass, coalesce(indexprs::text, ''), coalesce(indpred::text, '')
  having count(*) > 1
$$, 'no two indexes cover the same columns');

select is_empty($$
  select table_name || ' ' || grantee || ' ' || privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
$$, 'the API roles write no table directly: every write is an RPC');

select is(
  (select array_agg(table_name::text order by table_name) from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT'),
  array['billing_catalog'],
  'anon reads only the price list');

select is_empty($$
  select c.relname::text from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
    and (has_sequence_privilege('anon', c.oid, 'usage,select,update')
      or has_sequence_privilege('authenticated', c.oid, 'usage,select,update'))
$$, 'the API roles cannot read or move a sequence');

select is_empty($$
  select p.proname::text from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s like 'search_path=%')
$$, 'every security definer function pins its search_path');

-- A signed-in founder can call these with any arguments, as the owner. Each must check who is calling. The ones listed
-- delegate the check (save_marketing_document), check the app owner's email, or take an unguessable token.
select is_empty($$
  select p.proname::text from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.prosrc !~ 'auth\.uid\(\)|require_user'
    and p.proname not in ('cmo_chat_save_document', 'provider_spend_report', 'email_unsubscribe')
$$, 'every security definer function a founder can call checks who is calling');

select ok(has_table_privilege('service_role', 'public.credit_ledger', 'insert'), 'the service role keeps its writes');
select ok(has_table_privilege('authenticated', 'public.jobs', 'select'), 'founders still read their rows under RLS');

create table public.hardening_probe (id int primary key);
select ok(not has_table_privilege('anon', 'public.hardening_probe', 'select'), 'a new table is not readable by anon by default');
select ok(not has_table_privilege('authenticated', 'public.hardening_probe', 'insert'), 'nor writable by authenticated');

select * from finish();
rollback;
