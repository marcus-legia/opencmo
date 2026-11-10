-- cmo-review-3 I0 (20270115010000): the CMO chat orders a script. One call makes the calendar item, the
-- write_video_brief order and the Writer run that holds its price, in one transaction; nothing builds a video. A
-- founder with no plan gets the plan code and nothing is left behind; bad input is refused; anon cannot call it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

select ok(not has_function_privilege('anon', 'public.cmo_order_script(text,date,text)', 'execute'), 'anon cannot order a script');

insert into auth.users (id, email) values
  ('e2900000-0000-4000-8000-00000000000a', 'script-paid@test.local'),
  ('e2900000-0000-4000-8000-00000000000b', 'script-free@test.local');
update public.profiles set plan = 'starter', credit_balance = 10 where id = 'e2900000-0000-4000-8000-00000000000a';

create temp table t_order (result jsonb) on commit drop;
grant all on t_order to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2900000-0000-4000-8000-00000000000a","role":"authenticated"}';
insert into t_order select public.cmo_order_script('A 30 second demo: cut a video by deleting words.');
select throws_ok($$ select public.cmo_order_script(repeat('x', 301)) $$, '22023', null, 'a brief over 300 characters is refused');
select throws_ok($$ select public.cmo_order_script('A demo of the editor.', null, 'gemini') $$, '22023', null, 'only the founder''s own Claude is another brain');
select throws_ok($$ select public.cmo_order_script('A demo of the editor.', current_date - 1) $$, '22023', null, 'a day in the past is refused');
reset role;

select is((select count(*)::int from public.content_items where user_id = 'e2900000-0000-4000-8000-00000000000a' and department = 'video'), 1,
  'one video item on the calendar');
select is((select status from public.content_items where id = (select (result->>'item_id')::uuid from t_order)), 'planned', 'it waits on its script');
select is((select kind from public.work_orders where id = (select (result->>'order_id')::uuid from t_order)), 'write_video_brief', 'the order is the script');
select is((select item_id from public.work_orders where id = (select (result->>'order_id')::uuid from t_order)),
  (select (result->>'item_id')::uuid from t_order), 'the order belongs to the item, as the week plan''s does');
select is((select created_by from public.work_orders where id = (select (result->>'order_id')::uuid from t_order)), 'chat', 'the chat ordered it');
select is((select input->>'order_id' from public.cmo_runs where id = (select (result->>'run_id')::uuid from t_order)),
  (select result->>'order_id' from t_order), 'Writer runs for that order');
select is((select -sum(delta)::int from public.credit_ledger where user_id = 'e2900000-0000-4000-8000-00000000000a'
  and ref_kind = 'cmo_run' and ref_id = (select (result->>'run_id')::uuid from t_order)), public.cmo_job_price('write_video_brief'),
  'its price is held');
select is((select count(*)::int from public.work_orders where user_id = 'e2900000-0000-4000-8000-00000000000a' and kind = 'build_video'), 0,
  'nothing builds the video');

-- No plan, no credits: the plan code, and the calendar item rolls back with it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2900000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.cmo_order_script('A demo of the editor.') $$, 'P0402', null, 'unpaid: the plan code, nothing left behind');
reset role;

select * from finish();
rollback;
