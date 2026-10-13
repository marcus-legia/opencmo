-- 20261121090000: the worker's sweep closes abandoned Assistant turns and gives their held credits back.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(8);

insert into auth.users (id, email) values ('e1510000-0000-4000-8000-0000000000aa', 'reap-a@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1511000-0000-4000-8000-0000000000aa', 'e1510000-0000-4000-8000-0000000000aa', 'https://a', 600, 'done');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e1512000-0000-4000-8000-0000000000aa', 'e1511000-0000-4000-8000-0000000000aa', 0, 1, 20, 1, 20),
  ('e1512000-0000-4000-8000-0000000000ab', 'e1511000-0000-4000-8000-0000000000aa', 1, 21, 40, 21, 40);
insert into public.credit_ledger(user_id, delta, reason) values ('e1510000-0000-4000-8000-0000000000aa', 20, 'test grant');

select ok(not has_function_privilege('authenticated', 'public.agent_reap_turns()', 'execute'), 'only the worker can reap');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1510000-0000-4000-8000-0000000000aa"}';
-- One turn left running (the request died), one waiting on a card for a day.
create temporary table s1 as select * from public.agent_open_session('e1512000-0000-4000-8000-0000000000aa', 'claude-sonnet-5-5');
create temporary table s2 as select * from public.agent_open_session('e1512000-0000-4000-8000-0000000000ab', 'claude-sonnet-5-5');
create temporary table t1 as select * from public.agent_begin_turn((select id from s1), 'cut the pauses', '[{"text":"cut the pauses"}]');
create temporary table t2 as select * from public.agent_begin_turn((select id from s2), 'add b-roll', '[{"text":"add b-roll"}]');
select lives_ok($$ select public.agent_pause_turn((select id from t2), 'approval') $$, 'second turn waits on a card');
reset role;

select is(public.credit_balance('e1510000-0000-4000-8000-0000000000aa'), 10, 'both turns hold their credits');
select is(public.agent_reap_turns(), 0, 'nothing is reaped while the locks hold');

update public.agent_sessions set lock_until = now() - interval '1 minute' where id = (select id from s1);
update public.agent_sessions set updated_at = now() - interval '25 hours' where id = (select id from s2);
select is(public.agent_reap_turns(), 2, 'the dead and the abandoned turn are closed');
select is((select status from public.agent_turns where id = (select id from t1)), 'failed', 'a dead request fails the turn');
select is((select status from public.agent_turns where id = (select id from t2)), 'stopped', 'an abandoned card stops the turn');
select is(public.credit_balance('e1510000-0000-4000-8000-0000000000aa'), 20, 'the held credits are back');

select * from finish();
rollback;
