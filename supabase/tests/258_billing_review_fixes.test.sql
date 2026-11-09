-- Billing fixes (20270111020000): a turn that used more than it held is labelled "Assistant usage", one that used less
-- "Assistant refund"; a Studio order's usage covered by its hold reaches its spend (and its parent's) when it ends.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

insert into auth.users (id, email) values ('e2580000-0000-4000-8000-00000000000a', 'billing-a@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2581000-0000-4000-8000-00000000000a', 'e2580000-0000-4000-8000-00000000000a', 'storage://e2580000-0000-4000-8000-00000000000a/a.mp4', 600, 'done');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e2582000-0000-4000-8000-00000000000a', 'e2581000-0000-4000-8000-00000000000a', 0, 1, 20, 1, 20);
insert into public.credit_ledger (user_id, delta, reason) values ('e2580000-0000-4000-8000-00000000000a', 500, 'test grant');

-- ================================================================ Assistant labels
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2580000-0000-4000-8000-00000000000a","role":"authenticated"}';
create temporary table s as select * from public.agent_open_session('e2582000-0000-4000-8000-00000000000a', 'claude-sonnet-5-5');
create temporary table small as select * from public.agent_begin_turn((select id from s), 'Hi', '[{"text":"Hi"}]');
reset role;
select public.agent_close_turn((select id from small), 'done', null);
set local role authenticated;
create temporary table big as select * from public.agent_begin_turn((select id from s), 'Write a long script', '[{"text":"Write a long script"}]');
reset role;
-- As the service records it: 5M Sonnet input tokens are far more than a turn's hold.
select lives_ok($$ select public.agent_record_usage_for('e2580000-0000-4000-8000-00000000000a', (select id from big), 'claude-sonnet-5-5', 5000000, 0, 0, 0) $$,
  'a long turn records more than it held');
select public.agent_close_turn((select id from big), 'done', null);
select is((select reason from public.credit_ledger where ref_kind = 'agent_turn' and ref_id = (select id from small) and delta > 0), 'Assistant refund',
  'a turn under its hold gets the rest back as a refund');
select ok((select credits from public.agent_turns where id = (select id from big)) > (select hold_credits from public.agent_turns where id = (select id from big)),
  'the long turn used more than it held');
select is((select reason from public.credit_ledger where ref_kind = 'agent_turn' and ref_id = (select id from big) and delta < 0 order by created_at desc, delta limit 1),
  'Assistant usage', 'and the charge past the hold is usage, not a refund');
select is((select count(*)::int from public.credit_ledger where ref_kind = 'agent_turn' and ref_id = (select id from big) and reason = 'Assistant refund'), 0,
  'no refund row for it');

-- ================================================================ Studio spend
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;
insert into t select 'root', id from public.work_order_create('e2580000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  null, 'plan_week', 'Week', '{}', 1000);
insert into t select 'video', id from public.work_order_create('e2580000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from t where name = 'root'), 'build_video', 'Video', '{}', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2580000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';
select public.studio_order_hold((select id from t where name = 'video'));
select public.studio_record_usage((select id from t where name = 'video'), 'director-model', 10000, 2000, 0, 0);
reset role;
create temporary table used as
  select public.agent_credits((select sum(micro_usd)::bigint from public.work_order_usage where order_id = (select id from t where name = 'video'))) as credits;
select ok((select credits from used) between 1 and public.studio_plan_hold() - 1, 'the team used part of its allowance');
select is((select spent_credits from public.work_orders where id = (select id from t where name = 'video')), 0, 'not counted while it runs');

update public.work_orders set status = 'done' where id = (select id from t where name = 'video');
select is((select spent_credits from public.work_orders where id = (select id from t where name = 'video')), (select credits from used),
  'done: the order counts what its hold paid for');
select is((select spent_credits from public.work_orders where id = (select id from t where name = 'root')), (select credits from used),
  'and so does the week');

select * from finish();
rollback;
