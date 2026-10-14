-- 20261123090000: a request at the Assistant's step limit pauses with 'steps' and resumes without asking.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(6);

insert into auth.users (id, email) values ('e1530000-0000-4000-8000-0000000000aa', 'steps-a@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1531000-0000-4000-8000-0000000000aa', 'e1530000-0000-4000-8000-0000000000aa', 'https://a', 600, 'done');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e1532000-0000-4000-8000-0000000000aa', 'e1531000-0000-4000-8000-0000000000aa', 0, 1, 20, 1, 20);
insert into public.credit_ledger(user_id, delta, reason) values ('e1530000-0000-4000-8000-0000000000aa', 20, 'test grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1530000-0000-4000-8000-0000000000aa"}';
create temporary table s1 as select * from public.agent_open_session('e1532000-0000-4000-8000-0000000000aa', 'claude-sonnet-5-5');
create temporary table t1 as select * from public.agent_begin_turn((select id from s1), 'cut the pauses', '[{"text":"cut the pauses"}]');

select lives_ok($$ select public.agent_pause_turn((select id from t1), 'steps') $$, 'a turn pauses at the step limit');
select is((select status || '/' || pause_reason from public.agent_turns where id = (select id from t1)),
  'awaiting_continue/steps', 'it waits to continue, with the steps reason');
select ok((select lock_until <= now() + interval '6 minutes' from public.agent_sessions where id = (select id from s1)),
  'the tab continues soon, so the lock is short');
select is((select status from public.agent_resume_turn((select id from s1))), 'running', 'it resumes without more credits');
select throws_ok($$ select public.agent_pause_turn((select id from t1), 'nonsense') $$, '22023', 'Invalid pause reason.',
  'an unknown reason is still rejected');
reset role;

select throws_ok(
  $$ update public.agent_turns set pause_reason = 'nonsense' where id = (select id from t1) $$,
  '23514', null, 'the table rejects an unknown reason');

select * from finish();
rollback;
