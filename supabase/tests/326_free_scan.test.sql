-- Free scan A2 (20270131010000): an unpaid account's first Sales scan is free once its product document exists, the
-- second is the 402, a failed one gives the free scan back at most twice; a paid account pays 5 as before; the
-- `sales_reply_drafts` kind exists, runs 5 a day and is paid work (included at 0 since wave 2 A3, 330).
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(17);

insert into auth.users (id, email) values
  ('e3260000-0000-4000-8000-00000000000a', 'fs-a@test.local'),
  ('e3260000-0000-4000-8000-00000000000b', 'fs-b@test.local'),
  ('e3260000-0000-4000-8000-00000000000c', 'fs-c@test.local'),
  ('e3260000-0000-4000-8000-00000000000d', 'fs-d@test.local');
update public.profiles set plan = 'starter', credit_balance = 10 where id = 'e3260000-0000-4000-8000-00000000000b';
insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e3260000-0000-4000-8000-00000000000a', 'product', 1, '{"name":"Invoicer"}', 'agent'),
  ('e3260000-0000-4000-8000-00000000000b', 'product', 1, '{"name":"Paid"}', 'agent'),
  ('e3260000-0000-4000-8000-00000000000c', 'product', 1, '{"name":"Retry"}', 'agent');

-- Founder D: unpaid and no documents yet. The scan searches from them, so it is not free yet.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3260000-0000-4000-8000-00000000000d","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('sales_scan', '{"source":"onboarding"}') $$, 'P0402', null,
  'no product document: no free scan');
reset role;

-- Founder A: unpaid, documents written.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3260000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('sales_scan', '{"source":"onboarding"}')), 0, 'the first scan is free');
select is((select credits from public.enqueue_cmo_run('sales_scan', '{"source":"onboarding"}')), 0,
  'asking again while it is queued returns the same run');
reset role;
select is((select count(*)::int from public.cmo_runs where user_id = 'e3260000-0000-4000-8000-00000000000a' and kind = 'sales_scan'), 1,
  'one run, not two');
select is((select count(*)::int from public.credit_ledger where user_id = 'e3260000-0000-4000-8000-00000000000a'), 0, 'nothing is held');

-- A queued free scan holds the free one: a second scan with another brief is paid work.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3260000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('sales_scan', '{"brief":"other"}') $$, 'P0402', null,
  'a second scan while the first is queued needs a plan');
reset role;
update public.cmo_runs set status = 'done' where user_id = 'e3260000-0000-4000-8000-00000000000a' and kind = 'sales_scan';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3260000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('sales_scan', '{"source":"onboarding"}') $$, 'P0402', null,
  'after a done scan, the next needs a plan');
select throws_ok($$ select public.enqueue_cmo_run('sales_reply_drafts', '{}') $$, 'P0402', null,
  'writing the replies needs a plan');
reset role;

-- Founder C: a failed free scan gives it back, at most twice more.
insert into public.cmo_runs (user_id, kind, status, input, credits) values
  ('e3260000-0000-4000-8000-00000000000c', 'sales_scan', 'failed', '{}', 0),
  ('e3260000-0000-4000-8000-00000000000c', 'sales_scan', 'failed', '{}', 0);
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3260000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('sales_scan', '{}')), 0, 'after two failed scans, the next is still free');
reset role;
update public.cmo_runs set status = 'failed' where user_id = 'e3260000-0000-4000-8000-00000000000c' and status = 'queued';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3260000-0000-4000-8000-00000000000c","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('sales_scan', '{"brief":"again"}') $$, 'P0402', null,
  'after three failures the free scan is gone');
reset role;

-- Founder B: paid, charged as before.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3260000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('sales_scan', '{}')), 5, 'a paid account pays 5 for its first scan');
reset role;
select is((select credit_balance from public.profiles where id = 'e3260000-0000-4000-8000-00000000000b'), 5, 'and 5 are held');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3260000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('sales_reply_drafts', '{}')), 0, 'writing the replies is included (wave 2 A3)');
reset role;

-- The new kind.
select is(public.cmo_job_price('sales_reply_drafts'), 0, 'included: price 0 (wave 2 A3)');
select is(public.cmo_job_daily_limit('sales_reply_drafts'), 5, 'five a day');
update public.cmo_runs set status = 'done' where user_id = 'e3260000-0000-4000-8000-00000000000b' and kind = 'sales_reply_drafts';
insert into public.cmo_runs (user_id, kind, status, input, credits)
  select 'e3260000-0000-4000-8000-00000000000b', 'sales_reply_drafts', 'done', jsonb_build_object('n', g), 1 from generate_series(1, 4) g;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3260000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('sales_reply_drafts', '{}') $$, 'P0001', null, 'a sixth in a day is refused');
reset role;
select ok(not public.cmo_first_run_free('e3260000-0000-4000-8000-00000000000a', 'sales_reply_drafts'), 'the replies are never free');

select * from finish();
rollback;
