-- 20261129090000 (MCP on Modal): the hourly preview cap and single-use confirm codes.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(10);

insert into auth.users (id, email) values
  ('e1580000-0000-4000-8000-00000000000a', 'mcp-modal-a@test.local'),
  ('e1580000-0000-4000-8000-00000000000b', 'mcp-modal-b@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1580000-0000-4000-8000-00000000000a"}';

select is(
  (select bool_and(public.rate_limit_hit('mcp_preview', 30, 3600)) from generate_series(1, 30)),
  true, 'mcp_preview: 30 previews an hour pass');
select is(public.rate_limit_hit('mcp_preview', 30, 3600), false, 'mcp_preview: the 31st is refused');
select throws_ok($$ select public.rate_limit_hit('mcp_preview', 1000, 3600) $$, '22023', 'Invalid rate limit.', 'mcp_preview: the caller cannot raise its own cap');
select is(public.rate_limit_hit('mcp', 600, 3600), true, 'the existing mcp bucket still works');

select is(public.mcp_confirm_use('c0de0000-0000-4000-8000-000000000001'), true, 'a confirm code is accepted once');
select is(public.mcp_confirm_use('c0de0000-0000-4000-8000-000000000001'), false, 'the same code again is refused');
select throws_ok($$ select public.mcp_confirm_use(null) $$, '22023', 'That confirm code is not valid. Ask for the price again.', 'no nonce');
select throws_ok($$ select count(*) from public.mcp_confirms $$, '42501', null, 'the ledger is not readable');

set local request.jwt.claims = '{"sub":"e1580000-0000-4000-8000-00000000000b"}';
select is(public.mcp_confirm_use('c0de0000-0000-4000-8000-000000000001'), true, 'nonces are per user');

reset role;
-- Checked through the catalog (as 035/137): pgTAP on Supabase's PG17 used to segfault catching a
-- function permission error.
select is(has_function_privilege('anon', 'public.mcp_confirm_use(uuid)', 'execute'), false, 'anon cannot use confirm codes');

select * from finish();
rollback;
