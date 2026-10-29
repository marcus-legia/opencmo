-- P2 review fixes (20261228130000): a 0-credit child order under an overspent parent; the brain's Studio model calls
-- charged by real tokens on the order (`work_order_usage`, `studio_record_usage`).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

select ok(has_function_privilege('authenticated', 'public.studio_record_usage(uuid,text,integer,integer,integer,integer)', 'execute'),
  'the runner records usage under the founder''s brain session');
select ok(not has_function_privilege('anon', 'public.studio_record_usage(uuid,text,integer,integer,integer,integer)', 'execute'), 'anon cannot');
select ok(has_table_privilege('authenticated', 'public.work_order_usage', 'select'), 'founders read their usage');
select ok(not has_table_privilege('authenticated', 'public.work_order_usage', 'insert'), 'but never write it');

insert into auth.users (id, email) values ('e2090000-0000-4000-8000-00000000000a', 'a9@test.local');
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;

-- A parent that spent past its budget still takes children that ask for nothing.
insert into t select 'root', id from public.work_order_create('e2090000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  null, 'plan_week', 'Week', '{}', 10);
update public.work_orders set spent_credits = 25 where id = (select id from t where name = 'root');
select lives_ok($$ select public.work_order_create('e2090000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from t where name = 'root'), 'cut_shorts', 'Shorts', '{}', 0) $$, 'a 0-credit child is created under an overspent parent');
select throws_ok($$ select public.work_order_create('e2090000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from t where name = 'root'), 'post_draft', 'Post', '{}', 5) $$, 'P0001', 'The parent order has 0 credits left to hand out.',
  'a child that asks for credits is still refused');

-- Usage: the order's running total, settled on the ledger.
update public.work_orders set spent_credits = 0, budget_credits = 1000 where id = (select id from t where name = 'root');
insert into t select 'video', id from public.work_order_create('e2090000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from t where name = 'root'), 'build_video', 'Video', '{}', 0);
insert into public.credit_ledger (user_id, delta, reason) values ('e2090000-0000-4000-8000-00000000000a', 1000, 'test grant');
create temp table want (credits integer) on commit drop;
grant all on want to authenticated;
insert into want select public.agent_credits(public.agent_micro_usd('director-model', 400000, 60000, 0, 0) * 2);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2090000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.studio_record_usage((select id from t where name = 'video'), 'director-model', 1, 1, 0, 0) $$, '42501', null,
  'only the brain''s runner records usage');
set local request.jwt.claims = '{"sub":"e2090000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';
select public.studio_record_usage((select id from t where name = 'video'), 'director-model', 400000, 60000, 0, 0);
select is(public.studio_record_usage((select id from t where name = 'video'), 'director-model', 400000, 60000, 0, 0), (select credits from want),
  'two calls: the credits of their summed cost');
select throws_ok($$ select public.studio_record_usage((select id from t where name = 'video'), 'director-model', -1, 0, 0, 0) $$, '22023',
  'Invalid usage.', 'negative tokens are refused');
reset role;
select is(public.credit_held('work_order', (select id from t where name = 'video')), (select credits from want), 'charged once, on the order''s ledger ref');
select is((select spent_credits from public.work_orders where id = (select id from t where name = 'video')), (select credits from want),
  'and counted in the week''s credits used');
select is((select count(*)::int from public.work_order_usage where order_id = (select id from t where name = 'video')), 2, 'one row per call');

-- Short of balance: the call already ran, so what is left is charged, never more.
insert into public.credit_ledger (user_id, delta, reason)
values ('e2090000-0000-4000-8000-00000000000a', -(public.credit_balance('e2090000-0000-4000-8000-00000000000a') - 1), 'test spend');
set local role authenticated;
select public.studio_record_usage((select id from t where name = 'video'), 'director-model', 40000000, 6000000, 0, 0);
reset role;
select is(public.credit_balance('e2090000-0000-4000-8000-00000000000a'), 0, 'the balance never goes below zero');
select is(public.credit_held('work_order', (select id from t where name = 'video')), (select credits from want) + 1, 'only the last credit is charged');

select * from finish();
rollback;
