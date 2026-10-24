-- 20261221090000: the MCP look tools' hourly cap.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

insert into auth.users (id, email) values ('e1910000-0000-4000-8000-0000000000c1', 'mcp-look@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1910000-0000-4000-8000-0000000000c1"}';

select is(
  (select bool_and(public.rate_limit_hit('mcp_look', 60, 3600)) from generate_series(1, 60)),
  true, 'mcp_look: 60 looks an hour pass');
select is(public.rate_limit_hit('mcp_look', 60, 3600), false, 'mcp_look: the 61st is refused');
select throws_ok($$ select public.rate_limit_hit('mcp_look', 6000, 3600) $$, '22023', 'Invalid rate limit.', 'mcp_look: the caller cannot raise its own cap');
select is(public.rate_limit_hit('mcp_preview', 60, 3600), true, 'mcp_preview still works');

select * from finish();
rollback;
