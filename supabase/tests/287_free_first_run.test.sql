-- 3.1 (20270114020000): the first plan and the first draft are free, once per kind, read from history; the second is
-- the 402; `source` in the input changes nothing; a paid account is charged as before; unpaid onboarding is 2 runs ever.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(18);

insert into auth.users (id, email) values
  ('e2870000-0000-4000-8000-00000000000a', 'ff-a@test.local'),
  ('e2870000-0000-4000-8000-00000000000b', 'ff-b@test.local'),
  ('e2870000-0000-4000-8000-00000000000c', 'ff-c@test.local');
update public.profiles set plan = 'starter', credit_balance = 10 where id = 'e2870000-0000-4000-8000-00000000000b';

select ok(not has_function_privilege('authenticated', 'public.cmo_first_run_free(uuid, text)', 'execute'),
  'founders cannot call the free rule');

-- Founder A: no plan, no credits.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000a","role":"authenticated"}';

select is((select credits from public.enqueue_cmo_run('plan_week', '{"source":"onboarding"}')), 0, 'the first plan is free');
select is((select credits from public.enqueue_cmo_run('post_draft', '{"source":"onboarding"}')), 0, 'the first draft is free');
reset role;
select is((select count(*)::int from public.credit_ledger where user_id = 'e2870000-0000-4000-8000-00000000000a'), 0, 'nothing is held');

-- The first plan finishes; asking again (with any source) is paid work.
update public.cmo_runs set status = 'done' where user_id = 'e2870000-0000-4000-8000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('plan_week', '{"source":"schedule"}') $$, 'P0402', null, 'a second plan needs a plan');
select throws_ok($$ select public.enqueue_cmo_run('plan_week', '{"source":"onboarding"}') $$, 'P0402', null,
  'source onboarding in the input changes nothing');
select throws_ok($$ select public.enqueue_cmo_run('post_draft', '{"source":"onboarding","brief":"again"}') $$, 'P0402', null,
  'a second draft needs a plan');
select throws_ok($$ select public.enqueue_cmo_run('sales_scan', '{"brief":"founders"}') $$, 'P0402', null, 'a Sales scan needs a plan');
reset role;

-- A first plan that failed is tried again for free.
insert into public.cmo_runs (user_id, kind, status, input, credits) values
  ('e2870000-0000-4000-8000-00000000000c', 'plan_week', 'failed', '{}', 0);
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('plan_week', '{}')), 0, 'after a failed first plan, the next is still free');
reset role;

-- Three failed first plans: the next one is paid work.
insert into public.cmo_runs (user_id, kind, status, input, credits) values
  ('e2870000-0000-4000-8000-00000000000c', 'post_draft', 'failed', '{}', 0),
  ('e2870000-0000-4000-8000-00000000000c', 'post_draft', 'failed', '{}', 0),
  ('e2870000-0000-4000-8000-00000000000c', 'post_draft', 'failed', '{}', 0);
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000c","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('post_draft', '{"brief":"x"}') $$, 'P0402', null, 'after three failures the free run is gone');
reset role;

-- Founder B: paid, charged as before.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('plan_week', '{}')), 1, 'a paid account is charged for its first plan');
reset role;
select is((select credit_balance from public.profiles where id = 'e2870000-0000-4000-8000-00000000000b'), 9, 'and the credit is held');

-- Onboarding: 2 runs ever without a plan, then the 402; a paid account keeps going.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.start_cmo_run('onboard', '{"site":"exampel.com"}') $$, 'the first onboarding');
reset role;
update public.cmo_runs set status = 'failed' where user_id = 'e2870000-0000-4000-8000-00000000000a' and kind = 'onboard';
-- Two runs that failed on our side do not count.
insert into public.cmo_runs (user_id, kind, status, input) values
  ('e2870000-0000-4000-8000-00000000000a', 'onboard', 'failed', '{}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.start_cmo_run('onboard', '{"site":"example.com"}') $$, 'after failed runs, onboarding still runs');
reset role;
update public.cmo_runs set status = 'done' where user_id = 'e2870000-0000-4000-8000-00000000000a' and kind = 'onboard' and status = 'running';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.start_cmo_run('onboard', '{"site":"example.com"}') $$, 'a second, for a typo');
reset role;
update public.cmo_runs set status = 'done' where user_id = 'e2870000-0000-4000-8000-00000000000a' and kind = 'onboard';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.start_cmo_run('onboard', '{"site":"example.com"}') $$, 'P0402', null, 'a third needs a plan');
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000b","role":"authenticated"}';
select lives_ok($$ select public.start_cmo_run('onboard', '{"site":"a.com"}') $$, 'paid: onboarding');
reset role;
update public.cmo_runs set status = 'done' where user_id = 'e2870000-0000-4000-8000-00000000000b' and kind = 'onboard';
insert into public.cmo_runs (user_id, kind, status, input) values
  ('e2870000-0000-4000-8000-00000000000b', 'onboard', 'done', '{}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2870000-0000-4000-8000-00000000000b","role":"authenticated"}';
select lives_ok($$ select public.start_cmo_run('onboard', '{"site":"a.com"}') $$, 'paid: a third onboarding');
reset role;

select * from finish();
rollback;
