-- mcp_grants (20261210102000): a paid founder records and revokes their own grants through the
-- RPCs only; record and revoke are idempotent; nobody sees another user's rows.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email) values
  ('e1770000-0000-4000-8000-00000000000a', 'grants-a@test.local'),
  ('e1770000-0000-4000-8000-00000000000b', 'grants-b@test.local'),
  ('e1770000-0000-4000-8000-00000000000c', 'grants-free@test.local');
update public.profiles set plan = 'starter' where id in ('e1770000-0000-4000-8000-00000000000a', 'e1770000-0000-4000-8000-00000000000b');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1770000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.mcp_grant_record('client-1') $$, 'a paid founder records a grant');
select lives_ok($$ select public.mcp_grant_record('client-1') $$, 'recording twice is fine');
select is((select count(*)::int from public.mcp_grants), 1, 'one row per client');
select throws_ok($$ insert into public.mcp_grants (user_id, client_id) values ('e1770000-0000-4000-8000-00000000000a', 'x') $$,
  '42501', null, 'no direct insert');
select throws_ok($$ update public.mcp_grants set revoked_at = null $$, '42501', null, 'no direct update');
select throws_ok($$ select public.mcp_grant_record('') $$, '22023', 'This request is not valid.', 'an empty client id is refused');

select lives_ok($$ select public.mcp_grant_revoke('client-1') $$, 'revoke');
select lives_ok($$ select public.mcp_grant_revoke('client-1') $$, 'revoking twice is fine');
select ok((select revoked_at is not null from public.mcp_grants where client_id = 'client-1'), 'the grant is revoked');
select public.mcp_grant_record('client-1');
select ok((select revoked_at is null from public.mcp_grants where client_id = 'client-1'), 'approving again restores it');

set local request.jwt.claims = '{"sub":"e1770000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.mcp_grants), 0, 'another user sees none of them');

set local request.jwt.claims = '{"sub":"e1770000-0000-4000-8000-00000000000c"}';
select throws_ok($$ select public.mcp_grant_record('client-1') $$, 'P0001', 'Connecting apps to OpenCMO is part of the paid plans.', 'a free account cannot record a grant');

select * from finish();
rollback;
