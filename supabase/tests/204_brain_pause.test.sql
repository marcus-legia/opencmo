-- Brain B2 (20261227120000): Pause CMO starts nothing, claims nothing and stops a running job at its next step;
-- Resume picks the queue up again; a stuck order is replanned once.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(18);

insert into auth.users (id, email) values
  ('e2040000-0000-4000-8000-00000000000a', 'b2@test.local'),
  ('e2040000-0000-4000-8000-00000000000b', 'b2-other@test.local');
insert into public.credit_ledger (user_id, delta, reason) values ('e2040000-0000-4000-8000-00000000000a', 50, 'test grant');
update public.profiles set plan = 'starter' where id = 'e2040000-0000-4000-8000-00000000000a';

create temp table t (name text primary key, id uuid) on commit drop;
create function pg_temp.id(p text) returns uuid language sql as $$ select id from t where name = p $$;

select ok(has_function_privilege('authenticated', 'public.cmo_pause()', 'execute'), 'founders pause their CMO');
select ok(not has_function_privilege('authenticated', 'public.work_order_mark_replanned(uuid,text)', 'execute'), 'only the progress check replans');

-- A queued run and a running one, before the pause.
insert into t select 'queued', (public.cmo_enqueue('e2040000-0000-4000-8000-00000000000a', 'post_draft', '{}')).id;
with r as (insert into public.cmo_runs (user_id, kind, status, attempt, lease_until)
  values ('e2040000-0000-4000-8000-00000000000a', 'pull_metrics', 'running', 1, now() + interval '5 minutes') returning id)
insert into t select 'running', id from r;
with r as (insert into public.cmo_runs (user_id, kind, status) values ('e2040000-0000-4000-8000-00000000000b', 'post_draft', 'queued') returning id)
insert into t select 'other', id from r;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2040000-0000-4000-8000-00000000000a"}';
select isnt(public.cmo_pause(), null, 'pause returns when it started');
reset role;

select is((select cmo_paused_at is not null from public.profiles where id = 'e2040000-0000-4000-8000-00000000000a'), true, 'the flag is set');
select is((select not_before from public.cmo_runs where id = pg_temp.id('queued')), 'infinity'::timestamptz, 'queued runs are parked so the sweep skips them');
select throws_ok($$ select public.cmo_enqueue('e2040000-0000-4000-8000-00000000000a', 'sales_scan', '{}') $$, 'P0001',
  'Your CMO is paused. Resume it to start new work.', 'nothing new is queued');
select is((select public.cmo_run_step(pg_temp.id('running'), 1, '[]')), false, 'a running job stops at its next step');
update public.cmo_runs set not_before = null where id = pg_temp.id('queued');
select is((public.claim_cmo_run(pg_temp.id('queued'))).id, null, 'the claim never starts a paused founder''s run');
select is((public.claim_cmo_run(pg_temp.id('other'))).id, pg_temp.id('other'), 'other founders keep running');
update public.cmo_runs set lease_until = now() - interval '1 second' where id = pg_temp.id('running');
select public.claim_cmo_run(pg_temp.id('running'));
select is((select status || ' ' || not_before::text from public.cmo_runs where id = pg_temp.id('running')), 'queued infinity',
  'a lost lease goes back to the queue parked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2040000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.cmo_resume() $$, 'resume');
reset role;
select is((select count(*)::int from public.cmo_runs where user_id = 'e2040000-0000-4000-8000-00000000000a' and not_before = 'infinity'), 0,
  'resume unparks the queue');
select is((public.claim_cmo_run(pg_temp.id('queued'))).id, pg_temp.id('queued'), 'and the queue runs again');
select lives_ok($$ select public.cmo_enqueue('e2040000-0000-4000-8000-00000000000a', 'sales_scan', '{}') $$, 'new work is accepted again');

-- One replan per stuck order.
insert into t select 'root', (public.work_order_create('e2040000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  null, 'plan_week', 'Week', '{}', 10)).id;
insert into t select 'o', (public.work_order_create('e2040000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  pg_temp.id('root'), 'post_draft', 'Cut by words', '{}', 1)).id;
select public.work_order_move(pg_temp.id('o'), 'running');
select is((public.work_order_mark_replanned(pg_temp.id('o'), 'Running for 3 hours')).status, 'failed', 'a stuck running order fails first');
select is((select error->>'code' from public.work_orders where id = pg_temp.id('o')), 'stuck', 'with the reason the replan reads');
select throws_ok($$ select public.work_order_mark_replanned(pg_temp.id('o'), 'again') $$, 'P0001',
  'This order was already replanned once.', 'never a second replan');
select ok(exists (select 1 from public.work_order_events where order_id = pg_temp.id('o') and kind = 'note'), 'the log says the Planner was asked');

select * from finish();
rollback;
