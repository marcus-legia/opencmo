-- 20261120090000: Stop and resume take the session lock; a resume never revives a stopped turn.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

insert into auth.users (id, email) values ('e1500000-0000-4000-8000-00000000000a', 'lock-a@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1510000-0000-4000-8000-00000000000a', 'e1500000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e1520000-0000-4000-8000-00000000000a', 'e1510000-0000-4000-8000-00000000000a', 0, 1, 20, 1, 20);
insert into public.credit_ledger(user_id, delta, reason) values ('e1500000-0000-4000-8000-00000000000a', 20, 'test grant');

-- The race itself needs two connections; pin that both functions take the locks that serialise it.
select ok(pg_get_functiondef('public.agent_stop(uuid)'::regprocedure) ~* 'agent_sessions where id = p_session_id for update',
  'agent_stop locks the session like resume and begin_turn');
select ok(pg_get_functiondef('public.agent_resume_turn(uuid)'::regprocedure) ~* 'and status in \(''awaiting_browser'', ''awaiting_approval'', ''awaiting_input'', ''awaiting_continue''\)\s+returning',
  'agent_resume_turn only updates a turn that is still waiting');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-4000-8000-00000000000a"}';

create temporary table s as select * from public.agent_open_session('e1520000-0000-4000-8000-00000000000a', 'claude-sonnet-5-5');
grant select on s to authenticated;
create temporary table t as select * from public.agent_begin_turn((select id from s), 'Make it square', '[{"text":"Make it square"}]');
grant select on t to authenticated;
select lives_ok($$ select public.agent_record_tool((select id from t), 'tu_1', 'generate_media', '{}', 'pending', null) $$, 'a card waits for approval');
select lives_ok($$ select public.agent_pause_turn((select id from t), 'approval') $$, 'turn paused for approval');

select is((select status from public.agent_stop((select id from s))), 'stopped', 'Stop closes the waiting turn');
select throws_ok(
  $$ select public.agent_resume_turn((select id from s)) $$,
  'P0001', 'The assistant is not waiting for you.', 'Approve after Stop does not revive the turn'
);
select is((select status from public.agent_turns where id = (select id from t)), 'stopped', 'the turn stays stopped');

select * from finish();
rollback;
