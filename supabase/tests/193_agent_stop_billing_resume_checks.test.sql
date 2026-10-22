-- 20261222090000: usage recorded after Stop is billed up to the hold; a resume answers only the
-- pause it names; every turn RPC locks the credit owner before the session.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

grant execute on function public.agent_record_usage_for(uuid, uuid, text, integer, integer, integer, integer),
  public.agent_record_tool_for(uuid, uuid, text, text, jsonb, text, jsonb, jsonb) to authenticated;

select plan(13);

select ok(pg_get_functiondef('public.agent_stop(uuid)'::regprocedure) ~* 'lock_credit_owner\(v_user\);\s+perform 1 from public\.agent_sessions',
  'agent_stop: credit owner, then session');
select ok(pg_get_functiondef('public.agent_resume_turn(uuid,text,text[])'::regprocedure) ~* 'lock_credit_owner\(v_user\);\s+perform 1 from public\.agent_sessions',
  'agent_resume_turn: credit owner, then session');
select ok(pg_get_functiondef('public.agent_extend_hold(uuid)'::regprocedure) ~* 'lock_credit_owner\(v_user\);\s+perform 1 from public\.agent_sessions',
  'agent_extend_hold: credit owner, then session');
select ok(pg_get_functiondef('public.agent_reap_turns()'::regprocedure) ~* 'from public\.profiles .* skip locked.*from public\.agent_sessions .* skip locked',
  'agent_reap_turns: credit owner, then session');

insert into auth.users (id, email) values ('e1930000-0000-4000-8000-00000000000a', 'stop-bill@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1931000-0000-4000-8000-00000000000a', 'e1930000-0000-4000-8000-00000000000a', 'storage://e1930000-0000-4000-8000-00000000000a/a.mp4', 600, 'done');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e1932000-0000-4000-8000-00000000000a', 'e1931000-0000-4000-8000-00000000000a', 0, 1, 20, 1, 20);
insert into public.credit_ledger(user_id, delta, reason) values ('e1930000-0000-4000-8000-00000000000a', 50, 'test grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1930000-0000-4000-8000-00000000000a"}';

create temporary table s as select * from public.agent_open_session('e1932000-0000-4000-8000-00000000000a', 'claude-sonnet-5-5');
grant select on s to authenticated;

-- Stop, then the call it cut short records its usage: billed, never past the hold.
create temporary table t1 as select * from public.agent_begin_turn((select id from s), 'Write a long script', '[{"text":"Write a long script"}]');
grant select on t1 to authenticated;
select is((select status from public.agent_stop((select id from s))), 'stopped', 'Stop closes the running turn');
create temporary table before_usage as select public.credit_balance(auth.uid()) as balance, (select credits from public.agent_turns where id = (select id from t1)) as credits;
grant select on before_usage to authenticated;
select is((select credits from before_usage), 0, 'nothing was recorded before Stop');
select lives_ok($$ select public.agent_record_usage_for(auth.uid(), (select id from t1), 'claude-sonnet-5-5', 50000000, 0, 0, 0) $$,
  'the stopped call records its usage after the close');
select is((select credits from public.agent_turns where id = (select id from t1)), (select hold_credits from t1),
  'the turn is billed for it, capped at its hold');
select is(public.credit_balance(auth.uid()), (select balance from before_usage) - (select hold_credits from t1),
  'the balance pays exactly what was added');
select is((select count(*)::int from public.credit_ledger where user_id = auth.uid() and reason = 'Assistant usage after Stop'), 1,
  'one ledger row for it');

-- A resume names its pause: answers from an older pause (another tab) are refused.
create temporary table t2 as select * from public.agent_begin_turn((select id from s), 'Make an image', '[{"text":"Make an image"}]');
grant select on t2 to authenticated;
select public.agent_record_tool_for(auth.uid(), (select id from t2), 'tu_now', 'generate_media', '{}', 'pending', null, null);
select public.agent_pause_turn((select id from t2), 'approval');
select throws_ok($$ select public.agent_resume_turn((select id from s), null, array['tu_old']) $$,
  'P0001', 'The assistant is not waiting for that any more. Reload the chat.', 'a decision for another pause is refused');
select throws_ok($$ select public.agent_resume_turn((select id from s), 'awaiting_continue') $$,
  'P0001', 'The assistant is not waiting for that any more. Reload the chat.', 'a Continue is refused while a card waits');
select is((select status from public.agent_resume_turn((select id from s), null, array['tu_now'])), 'running',
  'the decision for this pause resumes it');

select * from finish();
rollback;
