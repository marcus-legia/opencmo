-- Review of #241 (20270202030000): a free account whose free scans all failed is not "used" (nothing found, nothing
-- locked); a founder's own deletion takes over an open row the unpaid cleanup left, so the self-deletion retry sees it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

insert into auth.users (id, email) values
  ('e3490000-0000-4000-8000-00000000000a', 'rf-fail@test.local'),
  ('e3490000-0000-4000-8000-00000000000b', 'rf-del@test.local');
insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e3490000-0000-4000-8000-00000000000a', 'product', 1, '{"name":"X"}', 'agent');
-- Three failed free scans end the free run.
insert into public.cmo_runs (user_id, kind, status, credits) values
  ('e3490000-0000-4000-8000-00000000000a', 'sales_scan', 'failed', 0),
  ('e3490000-0000-4000-8000-00000000000a', 'sales_scan', 'failed', 0),
  ('e3490000-0000-4000-8000-00000000000a', 'sales_scan', 'failed', 0);

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.as_user('e3490000-0000-4000-8000-00000000000a');
set local role authenticated;
select is((public.my_usage_state())->>'free_scan', 'failed', 'three failed free scans read as failed, not used');
select is((public.my_usage_state())->>'blocked', 'false', 'and lock nothing');
reset role;

-- The unpaid cleanup's open row, left when its deleteUser failed.
insert into public.account_deletions (user_id, source) values ('e3490000-0000-4000-8000-00000000000b', 'unpaid');
select pg_temp.as_user('e3490000-0000-4000-8000-00000000000b');
set local role authenticated;
select lives_ok($$ select public.account_delete('rf-del@test.local') $$, 'the founder deletes their account');
reset role;
select is((select source from public.account_deletions where user_id = 'e3490000-0000-4000-8000-00000000000b' and done_at is null),
  'self', 'their request takes over the open row, so the self-deletion retry sees it');

select * from finish();
rollback;
