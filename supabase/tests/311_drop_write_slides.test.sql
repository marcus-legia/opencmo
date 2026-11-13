-- 20270121030000: "Write a slideshow" is gone (F2). A new `write_slides` run is refused; one already queued or running
-- fails with its hold refunded exactly once, even when the worker finishes it afterwards; an open slides order is
-- cancelled; a finished run and its credits are left alone.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

insert into auth.users (id, email) values ('e3110000-0000-4000-8000-00000000000a', 'no-slides@test.local');
update public.profiles set plan = 'starter', credit_balance = 50 where id = 'e3110000-0000-4000-8000-00000000000a';

insert into public.cmo_runs (id, user_id, kind, status, credits, attempt, input) values
  ('e3111000-0000-4000-8000-00000000000a', 'e3110000-0000-4000-8000-00000000000a', 'write_slides', 'queued', 1, 0, '{"idea": "a"}'),
  ('e3111000-0000-4000-8000-00000000000b', 'e3110000-0000-4000-8000-00000000000a', 'write_slides', 'running', 1, 1, '{"idea": "b"}'),
  ('e3111000-0000-4000-8000-00000000000c', 'e3110000-0000-4000-8000-00000000000a', 'write_slides', 'done', 1, 1, '{"idea": "c"}');
select public.credit_hold('e3110000-0000-4000-8000-00000000000a', 'cmo_run', id, 1, 'CMO run') from public.cmo_runs
where user_id = 'e3110000-0000-4000-8000-00000000000a';
-- The finished run was charged: its hold settled at its price.
select public.credit_settle('e3110000-0000-4000-8000-00000000000a', 'cmo_run', 'e3111000-0000-4000-8000-00000000000c', 1, 'CMO run');
insert into public.work_orders (id, user_id, week, department, kind, title, status) values
  ('e3112000-0000-4000-8000-00000000000a', 'e3110000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
   'writer', 'write_slides', 'Slides for a slideshow', 'queued');

select is(public.credit_balance('e3110000-0000-4000-8000-00000000000a'), 47, 'three runs held a credit each');

select is(public.cmo_drop_write_slides(), 2, 'the queued and the running run are failed');
select is((select status from public.cmo_runs where id = 'e3111000-0000-4000-8000-00000000000a'), 'failed', 'the queued run failed');
select is((select status from public.cmo_runs where id = 'e3111000-0000-4000-8000-00000000000b'), 'failed', 'the running run failed');
select is((select status from public.cmo_runs where id = 'e3111000-0000-4000-8000-00000000000c'), 'done', 'a finished run is left alone');
select is(public.credit_balance('e3110000-0000-4000-8000-00000000000a'), 49, 'both holds came back; the finished run stays paid');
select is((select status from public.work_orders where id = 'e3112000-0000-4000-8000-00000000000a'), 'cancelled', 'the open slides order is cancelled');

-- Review focus 3: refunded once, not twice.
select is(public.cmo_drop_write_slides(), 0, 'a second sweep finds nothing');
select is(public.complete_cmo_run('e3111000-0000-4000-8000-00000000000b', 1, false, null, 'worker gave up'), false,
  'the worker finishing the running run afterwards changes nothing');
select is(public.credit_balance('e3110000-0000-4000-8000-00000000000a'), 49, 'and no credit moves a second time');

select is(public.cmo_job_daily_limit('write_slides'), 0, 'no slides run a day');
select throws_ok($$select public.enqueue_cmo_run_for('e3110000-0000-4000-8000-00000000000a', 'write_slides', '{"idea": "d"}')$$,
  '22023', 'Unknown task.', 'a new slides run is refused');
select ok(not has_function_privilege('authenticated', 'public.cmo_drop_write_slides()', 'execute'), 'a founder cannot call the sweep');

select * from finish();
rollback;
