-- 20261210201000: the Assistant's bookkeeping RPCs are service-role only (fix 9).
--
--   grants      — authenticated cannot call the four old functions nor the `_for` variants
--   early finish — the audit's B §5 scenario: the user cannot settle the turn before the server
--                  records the running model call, so that call is charged
--   caps        — tool input/result/content over 256 KB is refused
--   ownership   — `_for` with someone else's id finds no turn
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(17);

insert into auth.users (id, email) values
  ('e1810000-0000-4000-8000-00000000000a', 'ledger-a@test.local'),
  ('e1810000-0000-4000-8000-00000000000b', 'ledger-b@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1811000-0000-4000-8000-00000000000a', 'e1810000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e1812000-0000-4000-8000-00000000000a', 'e1811000-0000-4000-8000-00000000000a', 0, 1, 20, 1, 20);
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1810000-0000-4000-8000-00000000000a', 50, 'test grant');

-- ------------------------------------------------------------------ grants
select is(has_function_privilege('authenticated', 'public.agent_record_usage(uuid, text, integer, integer, integer, integer)', 'execute'), false, 'agent_record_usage is not callable by users');
select is(has_function_privilege('authenticated', 'public.agent_append(uuid, text, jsonb)', 'execute'), false, 'agent_append is not callable by users');
select is(has_function_privilege('authenticated', 'public.agent_record_tool(uuid, text, text, jsonb, text, jsonb, jsonb)', 'execute'), false, 'agent_record_tool is not callable by users');
select is(has_function_privilege('authenticated', 'public.agent_finish_turn(uuid, text, text)', 'execute'), false, 'agent_finish_turn is not callable by users');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('agent_record_usage_for', 'agent_append_for', 'agent_record_tool_for', 'agent_finish_turn_for')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  0, 'the _for variants are not callable by users');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('agent_record_usage_for', 'agent_append_for', 'agent_record_tool_for', 'agent_finish_turn_for')
     and has_function_privilege('service_role', p.oid, 'execute')),
  4, 'the server can call all four');

-- ------------------------------------------------------------- early finish
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1810000-0000-4000-8000-00000000000a"}';
create temporary table s as select * from public.agent_open_session('e1812000-0000-4000-8000-00000000000a', 'claude-opus-5');
create temporary table t as select * from public.agent_begin_turn((select id from s), 'Go', '[{"type":"text","text":"Go"}]'::jsonb);
grant select on s, t to authenticated, service_role;

select throws_ok($$ select public.agent_finish_turn((select id from t), 'done', null) $$,
  '42501', null, 'the user cannot settle their own turn early');
select throws_ok($$ select public.agent_record_tool((select id from t), 'x', 'set_frame', '{}', 'done', null) $$,
  '42501', null, 'nor write tool calls');

reset role;
set local role service_role;
select is(public.agent_record_usage_for('e1810000-0000-4000-8000-00000000000a', (select id from t), 'claude-opus-5', 10000, 2000, 0, 0),
  2, 'the running model call is recorded');
select is(public.agent_append_for('e1810000-0000-4000-8000-00000000000a', (select id from t), 'assistant', '[{"type":"text","text":"Done."}]'),
  2, 'and its message');
select is((select credits from public.agent_finish_turn_for('e1810000-0000-4000-8000-00000000000a', (select id from t), 'done', null)),
  2, 'the turn settles with that call charged');
reset role;
select is(public.credit_balance('e1810000-0000-4000-8000-00000000000a'), 48, 'the balance pays for it');

-- --------------------------------------------------------------------- caps
set local role authenticated;
create temporary table t2 as select * from public.agent_begin_turn((select id from s), 'Again', '[{"type":"text","text":"Again"}]'::jsonb);
grant select on t2 to service_role;
reset role;
set local role service_role;
select throws_ok(
  $$ select public.agent_record_tool_for('e1810000-0000-4000-8000-00000000000a', (select id from t2), 'big', 'set_frame',
       jsonb_build_object('pad', (select string_agg(md5(i::text), '') from generate_series(1, 9000) i)), 'done', null) $$,
  '22023', 'This tool call is too large to save.', 'a 288 KB input is refused');
select lives_ok(
  $$ select public.agent_record_tool_for('e1810000-0000-4000-8000-00000000000a', (select id from t2), 'ok', 'set_frame', '{"width":1080}', 'pending', null) $$,
  'a normal tool call is saved');
reset role;
set local role authenticated;
select throws_ok(
  $$ select public.agent_complete_tool((select id from t2), 'ok', 'done',
       jsonb_build_object('pad', (select string_agg(md5(i::text), '') from generate_series(1, 9000) i))) $$,
  '22023', 'This tool call is too large to save.', 'agent_complete_tool has the same cap');

-- ----------------------------------------------------------------- ownership
reset role;
set local role service_role;
select throws_ok(
  $$ select public.agent_append_for('e1810000-0000-4000-8000-00000000000b', (select id from t2), 'user', '[]') $$,
  'P0002', 'Assistant turn not found.', 'another user id finds no turn');
select throws_ok(
  $$ select public.agent_finish_turn_for('e1810000-0000-4000-8000-00000000000b', (select id from t2), 'done', null) $$,
  'P0002', 'Assistant turn not found.', 'nor settles it');

select * from finish();
rollback;
