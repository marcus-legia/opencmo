-- 20270109050000: a Studio order holds an allowance before its team calls a model; what the team does not use comes
-- back when the order ends.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

select ok(has_function_privilege('authenticated', 'public.studio_order_hold(uuid)', 'execute'), 'the runner holds under the founder''s brain session');
select ok(not has_function_privilege('anon', 'public.studio_order_hold(uuid)', 'execute'), 'anon cannot');

insert into auth.users (id, email) values ('e2550000-0000-4000-8000-00000000000a', 'a255@test.local');
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;
insert into t select 'root', id from public.work_order_create('e2550000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  null, 'plan_week', 'Week', '{}', 1000);
insert into t select 'video', id from public.work_order_create('e2550000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from t where name = 'root'), 'build_video', 'Video', '{}', 0);
insert into t select 'empty', id from public.work_order_create('e2550000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from t where name = 'root'), 'build_video', 'Video 2', '{}', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2550000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.studio_order_hold((select id from t where name = 'video')) $$, '42501', null, 'only the brain''s runner holds');
set local request.jwt.claims = '{"sub":"e2550000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';
-- At 0 credits the team does not start: nothing is called for free (review C1).
select throws_ok($$ select public.studio_order_hold((select id from t where name = 'video')) $$, 'P0001', null, 'refused at 0 credits');
reset role;

insert into public.credit_ledger (user_id, delta, reason) values ('e2550000-0000-4000-8000-00000000000a', 20, 'test grant');
set local role authenticated;
select is(public.studio_order_hold((select id from t where name = 'video')), public.studio_plan_hold(), 'holds the allowance');
select is(public.studio_order_hold((select id from t where name = 'video')), public.studio_plan_hold(), 'a retried order holds nothing more');
select public.studio_order_hold((select id from t where name = 'empty'));
reset role;
select is(public.credit_balance('e2550000-0000-4000-8000-00000000000a'), 20 - 2 * public.studio_plan_hold(), 'two orders, two allowances');

-- Usage within the allowance is not charged twice; the order ends keeping only what was used.
set local role authenticated;
select public.studio_record_usage((select id from t where name = 'video'), 'director-model', 10000, 2000, 0, 0);
reset role;
select is(public.credit_held('work_order', (select id from t where name = 'video')), public.studio_plan_hold(), 'usage under the allowance draws from it');
update public.work_orders set status = 'done' where id = (select id from t where name = 'video');
select is(public.credit_held('work_order', (select id from t where name = 'video')),
  public.agent_credits((select sum(micro_usd)::bigint from public.work_order_usage where order_id = (select id from t where name = 'video'))),
  'done: the order keeps what its team used');
select ok(public.credit_held('work_order', (select id from t where name = 'video')) between 1 and public.studio_plan_hold() - 1, 'and the rest came back');

-- An order that fails before its team used anything gives the whole allowance back, once.
update public.work_orders set status = 'failed' where id = (select id from t where name = 'empty');
select is(public.credit_held('work_order', (select id from t where name = 'empty')), 0, 'failed with no usage: all back');
update public.work_orders set status = 'cancelled' where id = (select id from t where name = 'empty');
select is((select count(*)::int from public.credit_ledger where ref_kind = 'work_order' and ref_id = (select id from t where name = 'empty')), 2,
  'the hold and one return, nothing on a second end');

select * from finish();
rollback;
