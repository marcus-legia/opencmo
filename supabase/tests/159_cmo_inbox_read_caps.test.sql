-- 20261128100000: hourly caps on social reads and read_site through MCP.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(6);

insert into auth.users (id, email) values
  ('e1590000-0000-4000-8000-00000000000a', 'caps-a@test.local'),
  ('e1590000-0000-4000-8000-00000000000b', 'caps-b@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1590000-0000-4000-8000-00000000000a"}';

select is((select bool_and(public.cmo_read_hit('mcp_site')) from generate_series(1, 20)), true, '20 site reads an hour');
select is(public.cmo_read_hit('mcp_site'), false, 'the 21st is refused');
select is(public.cmo_read_hit('mcp_social'), true, 'buckets are separate');
select throws_ok($$ select public.cmo_read_hit('jobs') $$, '22023', 'Invalid rate limit.', 'only its own buckets');

set local request.jwt.claims = '{"sub":"e1590000-0000-4000-8000-00000000000b"}';
select is(public.cmo_read_hit('mcp_site'), true, 'per founder');

reset role;
set local role anon;
select throws_ok($$ select public.cmo_read_hit('mcp_site') $$, '42501', null, 'not for anon');

select * from finish();
rollback;
