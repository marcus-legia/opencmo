-- Wave 2 A3 (20270131020001): reply drafts cost 0 and stay paid work; an unpaid account whose free scan found no one
-- gets one more free scan, not a third, and not while one is still queued or after one that found people.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email) values
  ('e3300000-0000-4000-8000-00000000000a', 'rs-none@test.local'),
  ('e3300000-0000-4000-8000-00000000000b', 'rs-found@test.local'),
  ('e3300000-0000-4000-8000-00000000000c', 'rs-paid@test.local');
update public.profiles set plan = 'starter', credit_balance = 10 where id = 'e3300000-0000-4000-8000-00000000000c';
insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e3300000-0000-4000-8000-00000000000a', 'product', 1, '{"name":"Nobody"}', 'agent'),
  ('e3300000-0000-4000-8000-00000000000b', 'product', 1, '{"name":"Somebody"}', 'agent');

-- Reply drafts.
select is(public.cmo_job_price('sales_reply_drafts'), 0, 'reply drafts cost 0');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3300000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('sales_reply_drafts', '{}') $$, 'P0402', null,
  'an unpaid account still needs a plan for them');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3300000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('sales_reply_drafts', '{}')), 0, 'a paid account starts them at 0');
reset role;
select is((select credit_balance from public.profiles where id = 'e3300000-0000-4000-8000-00000000000c'), 10, 'nothing is held');

-- Founder A: the free scan found no one.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3300000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('sales_scan', '{"source":"onboarding"}')), 0, 'the first scan is free');
reset role;
select ok(not public.cmo_first_run_free('e3300000-0000-4000-8000-00000000000a', 'sales_scan'), 'not while it is still queued');
update public.cmo_runs set status = 'done', output = '{"verdict":"none","cards":0}'
where user_id = 'e3300000-0000-4000-8000-00000000000a' and kind = 'sales_scan';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3300000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('sales_scan', '{"brief":"after strategy"}')), 0,
  'after a scan that found no one, one more is free');
select throws_ok($$ select public.enqueue_cmo_run('sales_scan', '{"brief":"third"}') $$, 'P0402', null,
  'not a third while the second is queued');
reset role;
update public.cmo_runs set status = 'done', output = '{"verdict":"none","cards":0}'
where user_id = 'e3300000-0000-4000-8000-00000000000a' and kind = 'sales_scan' and status = 'queued';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3300000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('sales_scan', '{"brief":"third"}') $$, 'P0402', null,
  'two scans that found no one: the third needs a plan');
reset role;
select is((select count(*)::int from public.credit_ledger where user_id = 'e3300000-0000-4000-8000-00000000000a'), 0,
  'the free scans held nothing');

-- Founder B: the free scan found people.
insert into public.cmo_runs (user_id, kind, status, input, credits, output) values
  ('e3300000-0000-4000-8000-00000000000b', 'sales_scan', 'done', '{}', 0, '{"verdict":"found","cards":3}');
select ok(not public.cmo_first_run_free('e3300000-0000-4000-8000-00000000000b', 'sales_scan'), 'a scan that found people ends the free scans');
update public.cmo_runs set output = null where user_id = 'e3300000-0000-4000-8000-00000000000b' and kind = 'sales_scan';
select ok(not public.cmo_first_run_free('e3300000-0000-4000-8000-00000000000b', 'sales_scan'), 'a done scan with no verdict is not one that found no one');

select * from finish();
rollback;
