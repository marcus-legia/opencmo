-- Credit system review 2026-10-22 (20261225090000):
--   sent      — a cancel keeps credits only after `mark_generation_sent`; before it, a running cancel is refunded
--   reclaim   — a reclaimed task that had reached the provider keeps its credits when cancelled while queued
--   limit     — `create_generation` counts new generations in SQL (`generation_create`); reuse does not count
--   grants    — the worker-only RPC and the write-budget ledger are out of the user's reach
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select no_plan();

insert into auth.users (id, email) values
  ('e1980000-0000-4000-8000-00000000000a', 'credit-a@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1981000-0000-4000-8000-00000000000a', 'e1980000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1980000-0000-4000-8000-00000000000a', 20, 'test grant');

create function pg_temp.balance() returns int language sql as $$
  select public.credit_balance('e1980000-0000-4000-8000-00000000000a')
$$;
create temporary table t_start as select pg_temp.balance() as b;
grant select on t_start to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1980000-0000-4000-8000-00000000000a"}';

-- ================================================================ sent: cancel before the provider call
create temporary table s1 as
  select public.create_generation('e1981000-0000-4000-8000-00000000000a', null,
    'fake-video', '{"prompt":"waves","aspectRatio":"1:1","duration":5}', repeat('1', 64), gen_random_uuid()) as r;
grant select on s1 to authenticated;
select is(pg_temp.balance(), (select b from t_start) - 5, 'the video holds 5');

reset role;
create temporary table c1 as select * from public.claim_next_task(array['generate'], 300);
grant select on c1 to authenticated;
set local role authenticated;
-- The worker is still downloading and checking inputs: nothing was paid yet.
select is((select public.cancel_generation((select (r->'generation'->>'id')::uuid from s1))->>'status'), 'cancelled',
  'cancel while running, before the request is sent');
select is(pg_temp.balance(), (select b from t_start), 'cancelled before the provider call: refunded in full');
select is((select credits_final from public.generations where id = (select (r->'generation'->>'id')::uuid from s1)), 0,
  'credits_final is 0');
reset role;
select ok(not public.mark_generation_sent((select id from c1), (select attempt_id from c1)),
  'the worker cannot mark a cancelled task sent: it stops without calling the provider');

-- ================================================================ sent: cancel after the provider call
set local role authenticated;
create temporary table s2 as
  select public.create_generation('e1981000-0000-4000-8000-00000000000a', null,
    'fake-video', '{"prompt":"rain","aspectRatio":"1:1","duration":5}', repeat('2', 64), gen_random_uuid()) as r;
grant select on s2 to authenticated;
reset role;
create temporary table c2 as select * from public.claim_next_task(array['generate'], 300);
select ok(not public.mark_generation_sent((select id from c2), gen_random_uuid()), 'another attempt cannot mark it');
select ok(public.mark_generation_sent((select id from c2), (select attempt_id from c2)), 'the worker marks it sent');
select ok(public.mark_generation_sent((select id from c2), (select attempt_id from c2)), 'marking twice is harmless');

-- ================================================================ reclaim: sent, then requeued, then cancelled
update public.tasks set lease_until = now() - interval '1 second' where id = (select id from c2);
select is((public.reclaim_expired_tasks()->>'requeued')::int, 1, 'the lost task is requeued');
select is((select status from public.generations where id = (select (r->'generation'->>'id')::uuid from s2)), 'queued',
  'the generation is queued again');
set local role authenticated;
select is((select public.cancel_generation((select (r->'generation'->>'id')::uuid from s2))->>'status'), 'cancelled',
  'cancel the requeued generation');
select is(pg_temp.balance(), (select b from t_start) - 5, 'it had reached the provider: the credits stay spent');
select is((select credits_final from public.generations where id = (select (r->'generation'->>'id')::uuid from s2)), 5,
  'credits_final is the hold');

-- A queued generation never claimed is refunded as before.
create temporary table s3 as
  select public.create_generation('e1981000-0000-4000-8000-00000000000a', null,
    'fake-image', '{"prompt":"sun","aspectRatio":"1:1"}', repeat('3', 64), gen_random_uuid()) as r;
grant select on s3 to authenticated;
select is((select public.cancel_generation((select (r->'generation'->>'id')::uuid from s3))->>'status'), 'cancelled',
  'cancel while queued');
select is(pg_temp.balance(), (select b from t_start) - 5, 'queued cancel: refunded in full');

-- ================================================================ limit: create_generation in SQL
select ok(public.rate_limit_hit('generation_create', 120, 3600) is not null, 'the generation_create bucket is allowed');
select throws_ok($$ select public.rate_limit_hit('generation_create', 1000, 3600) $$,
  '22023', 'Invalid rate limit.', 'another limit for the bucket is refused');

reset role;
-- Fill this hour's window (the 4 creates above plus the check made 5 hits).
update public.rate_limits set count = 120
where user_id = 'e1980000-0000-4000-8000-00000000000a' and bucket = 'generation_create';
set local role authenticated;
select throws_ok(
  $$ select public.create_generation('e1981000-0000-4000-8000-00000000000a', null,
       'fake-image', '{"prompt":"moon","aspectRatio":"1:1"}', repeat('4', 64), gen_random_uuid()) $$,
  'P0001', 'Too many generations started. Wait a while and try again.', 'the 121st new generation in an hour is refused');
select is((select (public.create_generation('e1981000-0000-4000-8000-00000000000a', null,
    'fake-video', '{"prompt":"rain","aspectRatio":"1:1","duration":5}', repeat('2', 64),
    (select request_id from public.tasks where id = (select (r->'generation'->>'task_id')::uuid from s2))))->>'reused'),
  'true', 'resending a request id still returns its generation past the limit');
select is(pg_temp.balance(), (select b from t_start) - 5, 'a refused or reused request moves no credits');

-- ================================================================ grants
reset role;
select ok(not has_function_privilege('authenticated', 'public.mark_generation_sent(uuid, uuid)', 'execute'),
  'a user cannot mark a generation sent');
select ok(not has_function_privilege('anon', 'public.mark_generation_sent(uuid, uuid)', 'execute'),
  'anon cannot mark a generation sent');
select ok(has_function_privilege('service_role', 'public.mark_generation_sent(uuid, uuid)', 'execute'),
  'the worker can');
select ok(not has_table_privilege('authenticated', 'public.write_budget_ledger', 'select'), 'a user cannot read the ledger');
select ok(not has_table_privilege('authenticated', 'public.write_budget_ledger', 'delete'), 'a user cannot clear the ledger');
select ok(has_table_privilege('service_role', 'public.write_budget_ledger', 'delete'), 'the server can');
-- Table grants are Supabase's defaults; RLS has no update policy on generations, so the update matches nothing.
set local role authenticated;
update public.generations set sent_at = now() where id = (select (r->'generation'->>'id')::uuid from s3);
reset role;
select is((select sent_at from public.generations where id = (select (r->'generation'->>'id')::uuid from s3)), null,
  'a user cannot set sent_at');

select * from finish();
rollback;
