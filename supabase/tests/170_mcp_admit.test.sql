-- 202612100… (security fixes plan, items 2 and 5): one admission call per MCP request, and
-- `api_key_owner` writes `last_used_at` at most every 5 minutes.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

insert into auth.users (id, email) values
  ('e1700000-0000-4000-8000-00000000000a', 'mcp-admit-free@test.local'),
  ('e1700000-0000-4000-8000-00000000000b', 'mcp-admit-paid@test.local'),
  ('e1700000-0000-4000-8000-00000000000c', 'mcp-admit-other@test.local');
update public.profiles set plan = 'starter' where id = 'e1700000-0000-4000-8000-00000000000b';
update public.profiles set plan = 'creator' where id = 'e1700000-0000-4000-8000-00000000000c';

insert into public.api_keys (id, user_id, name, prefix, key_hash, last_used_at) values
  ('e1700000-0000-4000-8000-0000000000f1', 'e1700000-0000-4000-8000-00000000000b', 'fresh', 'ocm_aaaaaaa',
   repeat('a', 64), now() - interval '1 minute'),
  ('e1700000-0000-4000-8000-0000000000f2', 'e1700000-0000-4000-8000-00000000000b', 'stale', 'ocm_bbbbbbb',
   repeat('b', 64), now() - interval '10 minutes');

-- api_key_owner (service role, as the MCP server calls it)
set local role service_role;
select is(public.api_key_owner(repeat('a', 64)), 'e1700000-0000-4000-8000-00000000000b'::uuid, 'a key names its owner');
select is(public.api_key_owner(repeat('b', 64)), 'e1700000-0000-4000-8000-00000000000b'::uuid, 'a stale key names its owner too');
select is(public.api_key_owner(repeat('c', 64)), null, 'an unknown key names nobody');
reset role;
select ok((select last_used_at < now() - interval '30 seconds' from public.api_keys where key_hash = repeat('a', 64)),
  'a key used a minute ago is not written again');
select is((select last_used_at from public.api_keys where key_hash = repeat('b', 64)), now(),
  'a key last used 10 minutes ago is written');

-- mcp_admit
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1700000-0000-4000-8000-00000000000a"}';
select is(public.mcp_admit(1), 'free_plan', 'a free account cannot use MCP');
select throws_ok($$ select public.mcp_admit(0) $$, '22023', 'Send 1 to 20 messages per request.', 'at least one message');
select throws_ok($$ select public.mcp_admit(21) $$, '22023', 'Send 1 to 20 messages per request.', 'at most 20 messages');

set local request.jwt.claims = '{"sub":"e1700000-0000-4000-8000-00000000000b"}';
select is(
  (select bool_and(public.mcp_admit(20) = 'ok') from generate_series(1, 30)),
  true, '600 messages an hour pass, 20 per call');
select is(public.mcp_admit(1), 'rate_limited', 'the 601st message is refused');

set local request.jwt.claims = '{"sub":"e1700000-0000-4000-8000-00000000000c"}';
select is(public.mcp_admit(20), 'ok', 'another user is unaffected');

reset role;
select is((select count from public.rate_limits where user_id = 'e1700000-0000-4000-8000-00000000000b' and bucket = 'mcp'), 601,
  'one row in the existing mcp bucket counts messages, not calls');
select is((select count(*)::int from public.rate_limits where user_id = 'e1700000-0000-4000-8000-00000000000a'), 0,
  'a free account writes no rate-limit row');
-- Through the catalog (as 160): pgTAP on Supabase's PG17 used to segfault catching a permission error.
select is(has_function_privilege('anon', 'public.mcp_admit(integer)', 'execute'), false, 'anon cannot call mcp_admit');

select * from finish();
rollback;
