-- The owner's CMO funnel (20270126010000): owners only, the cohort is the window's sign-ups minus owner accounts, each
-- step counts accounts that reached it, and an old account is not in the cohort. Counts are compared before and after
-- the seed, so the test holds on a database that already has accounts.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email, created_at) values
  ('e3180000-0000-4000-8000-0000000000ff', 'funnel-owner@test.local', now() - interval '3 days');
insert into public.product_events (user_id, kind, paid, ref_id, at) values
  ('e3180000-0000-4000-8000-0000000000ff', 'onboarded', false, gen_random_uuid(), now() - interval '3 days');

select ok(not has_function_privilege('anon', 'public.cmo_funnel_report(integer)', 'execute'), 'anon cannot call it');

create function pg_temp.report() returns jsonb language sql as $f$ select public.cmo_funnel_report(30) $f$;
create function pg_temp.step(j jsonb, p text) returns int language sql as $f$
  select (s->>'users')::int from jsonb_array_elements(j->'steps') s where s->>'step' = p
$f$;
grant execute on function pg_temp.report() to authenticated;
grant execute on function pg_temp.step(jsonb, text) to authenticated;

insert into public.app_owners (email) values ('funnel-owner@test.local');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3180000-0000-4000-8000-0000000000ff","email":"funnel-owner@test.local"}';
select throws_ok($$ select public.cmo_funnel_report(0) $$, '22023', 'Pick 1 to 365 days.', 'the window is bounded');
create temp table before_seed on commit drop as select pg_temp.report() as j;
reset role;

-- a: onboarded, approved (today), scheduled, posted, paid. b: onboarded and approved. c: signed up only.
-- old: everything, but before the window.
insert into auth.users (id, email, created_at) values
  ('e3180000-0000-4000-8000-00000000000a', 'funnel-a@test.local', now() - interval '10 days'),
  ('e3180000-0000-4000-8000-00000000000b', 'funnel-b@test.local', now() - interval '2 days'),
  ('e3180000-0000-4000-8000-00000000000c', 'funnel-c@test.local', now() - interval '1 day'),
  ('e3180000-0000-4000-8000-00000000000d', 'funnel-old@test.local', now() - interval '90 days');
insert into public.product_events (user_id, kind, paid, ref_id, at) values
  ('e3180000-0000-4000-8000-00000000000a', 'onboarded', false, gen_random_uuid(), now() - interval '10 days' + interval '1 hour'),
  ('e3180000-0000-4000-8000-00000000000a', 'approve', true, gen_random_uuid(), now() - interval '1 hour'),
  ('e3180000-0000-4000-8000-00000000000a', 'schedule', true, gen_random_uuid(), now() - interval '1 hour'),
  ('e3180000-0000-4000-8000-00000000000a', 'posted', true, gen_random_uuid(), now() - interval '30 minutes'),
  ('e3180000-0000-4000-8000-00000000000b', 'onboarded', false, gen_random_uuid(), now() - interval '2 days' + interval '3 hours'),
  ('e3180000-0000-4000-8000-00000000000b', 'approve', false, gen_random_uuid(), now() - interval '1 day'),
  ('e3180000-0000-4000-8000-00000000000d', 'onboarded', false, gen_random_uuid(), now() - interval '89 days'),
  ('e3180000-0000-4000-8000-00000000000d', 'approve', false, gen_random_uuid(), now() - interval '88 days');
update public.profiles set plan = 'starter' where id = 'e3180000-0000-4000-8000-00000000000a';

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3180000-0000-4000-8000-00000000000b","email":"funnel-b@test.local"}';
select throws_ok($$ select public.cmo_funnel_report(30) $$, '42501', 'Not available.', 'a founder cannot read the funnel');

set local request.jwt.claims = '{"sub":"e3180000-0000-4000-8000-0000000000ff","email":"funnel-owner@test.local"}';
create temp table after_seed on commit drop as select pg_temp.report() as j;
reset role;

create function pg_temp.delta(p text) returns int language sql as $f$
  select pg_temp.step((select j from after_seed), p) - pg_temp.step((select j from before_seed), p)
$f$;

select is(pg_temp.delta('signed_up'), 3, 'the cohort grows by a, b, c (not the old account, not the owner)');
select is(pg_temp.delta('onboarded'), 2, 'a and b onboarded');
select is(pg_temp.delta('approved'), 2, 'a and b approved a card');
select is(pg_temp.delta('scheduled'), 1, 'a scheduled');
select is(pg_temp.delta('posted'), 1, 'a posted');
select is(pg_temp.delta('paid'), 1, 'a pays');
select is(
  ((select j from after_seed)->'active_7d'->>'paid_active')::int - ((select j from before_seed)->'active_7d'->>'paid_active')::int,
  1, 'a is 7 days old, approved today and pays: one more paid account active this week');
select ok(((select j from after_seed)->'median_seconds'->>'onboarded') is not null, 'a median time to onboard is given');
select ok(jsonb_array_length((select j from after_seed)->'by_week') >= 1, 'weekly cohorts are listed');

select * from finish();
rollback;
