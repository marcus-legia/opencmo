-- What failed for founders (20270128010000): owners only, the window is bounded, owner accounts are left out, two
-- failures that differ only by an id or a number are one group, and a job whose lease ran out counts as stuck. The
-- error texts are unique to this file, so the test holds on a database that already has failures.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(15);

select ok(not has_function_privilege('anon', 'public.ops_failures_report(integer)', 'execute'), 'anon cannot call it');
select ok(has_function_privilege('authenticated', 'public.ops_failures_report(integer)', 'execute'), 'a signed-in user can call it (and is refused inside)');

insert into auth.users (id, email, created_at) values
  ('e3220000-0000-4000-8000-0000000000ff', 'failures-owner@test.local', now() - interval '30 days'),
  ('e3220000-0000-4000-8000-00000000000a', 'failures-a@test.local', now() - interval '30 days'),
  ('e3220000-0000-4000-8000-00000000000b', 'failures-b@test.local', now() - interval '30 days');
insert into public.app_owners (email) values ('failures-owner@test.local');

-- a and b hit the same bug with a different id and duration; the owner hits it too (left out); a's old failure is
-- outside the window; b's second job hangs with its lease out for an hour.
insert into public.jobs (id, user_id, source_url, status, error, finished_at, lease_until) values
  ('e3221000-0000-4000-8000-00000000000a', 'e3220000-0000-4000-8000-00000000000a', 'https://a', 'failed',
    'Zqfailprobe probe of 0b1e7c55-0000-4000-8000-000000000001.mp4 failed after 12 s.', now() - interval '1 day', null),
  ('e3221000-0000-4000-8000-00000000000b', 'e3220000-0000-4000-8000-00000000000b', 'https://b', 'failed',
    '  Zqfailprobe probe of  9f2d0a11-0000-4000-8000-000000000002.mp4 failed after 37.5 s.', now() - interval '2 hours', null),
  ('e3221000-0000-4000-8000-0000000000ff', 'e3220000-0000-4000-8000-0000000000ff', 'https://o', 'failed',
    'Zqfailprobe probe of 11111111-0000-4000-8000-000000000003.mp4 failed after 1 s.', now() - interval '1 hour', null),
  ('e3221000-0000-4000-8000-0000000000a0', 'e3220000-0000-4000-8000-00000000000a', 'https://old', 'failed',
    'Zqfailprobe probe of 22222222-0000-4000-8000-000000000004.mp4 failed after 2 s.', now() - interval '20 days', null),
  ('e3221000-0000-4000-8000-0000000000b1', 'e3220000-0000-4000-8000-00000000000b', 'https://b1', 'running',
    null, null, now() - interval '1 hour');

-- b's onboarding has run for an hour with no lease (onboarding runs in the founder's request).
insert into public.cmo_runs (id, user_id, kind, status, started_at) values
  ('e3222000-0000-4000-8000-00000000000b', 'e3220000-0000-4000-8000-00000000000b', 'onboard', 'running', now() - interval '1 hour');

create function pg_temp.report(p int) returns jsonb language sql as $f$ select public.ops_failures_report(p) $f$;
grant execute on function pg_temp.report(int) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3220000-0000-4000-8000-00000000000a","email":"failures-a@test.local"}';
select throws_ok($$ select public.ops_failures_report(7) $$, '42501', 'Not available.', 'a founder cannot read it');
select is(public.ops_is_owner(), false, 'a founder is not an owner');

set local request.jwt.claims = '{"sub":"e3220000-0000-4000-8000-0000000000ff","email":"failures-owner@test.local"}';
select is(public.ops_is_owner(), true, 'the owner is');
select throws_ok($$ select public.ops_failures_report(0) $$, '22023', 'Pick 1 to 90 days.', 'zero days is refused');
select throws_ok($$ select public.ops_failures_report(91) $$, '22023', 'Pick 1 to 90 days.', 'more than 90 days is refused');
create temp table week on commit drop as select pg_temp.report(7) as j;
create temp table month on commit drop as select pg_temp.report(30) as j;
reset role;

create function pg_temp.grp(j jsonb, k text) returns jsonb language sql as $f$
  select g from jsonb_array_elements(j->'groups') g where g->>'source' = 'jobs' and g->>'key' = k
$f$;

select is(pg_temp.grp((select j from week), 'Zqfailprobe probe of <id>.mp4 failed after <n> s.')->>'failures', '2',
  'a and b are one group: the ids and durations collapse (not the 4 of mp4), the owner is left out');
select is(pg_temp.grp((select j from week), 'Zqfailprobe probe of <id>.mp4 failed after <n> s.')->>'accounts', '2', 'it hit two accounts');
select is(pg_temp.grp((select j from month), 'Zqfailprobe probe of <id>.mp4 failed after <n> s.')->>'failures', '3',
  'a 30-day window takes a''s older failure too');
select is(
  (select jsonb_agg(r->>'id' order by r->>'id') from jsonb_array_elements(pg_temp.grp((select j from week), 'Zqfailprobe probe of <id>.mp4 failed after <n> s.')->'latest') r),
  '["e3221000-0000-4000-8000-00000000000a", "e3221000-0000-4000-8000-00000000000b"]'::jsonb,
  'the latest rows give the job ids');
select ok(
  exists (select 1 from jsonb_array_elements((select j from week)->'groups') g, jsonb_array_elements(g->'latest') r
    where g->>'key' = 'Stuck: still running past its lease or time limit.' and (g->>'stuck')::boolean
      and r->>'id' = 'e3221000-0000-4000-8000-0000000000b1'),
  'a job whose lease ran out an hour ago counts as stuck');
select ok(
  exists (select 1 from jsonb_array_elements((select j from week)->'groups') g, jsonb_array_elements(g->'latest') r
    where g->>'source' = 'cmo_runs' and g->>'kind' = 'onboard' and r->>'id' = 'e3222000-0000-4000-8000-00000000000b'),
  'an onboarding running for an hour without a lease counts as stuck');
select ok(
  not exists (select 1 from jsonb_array_elements((select j from month)->'groups') g, jsonb_array_elements(g->'latest') r
    where r->>'user_id' = 'e3220000-0000-4000-8000-0000000000ff'),
  'no row of an owner account is listed');
select ok(
  not exists (select 1 from jsonb_array_elements((select j from month)->'groups') g, jsonb_array_elements(g->'latest') r
    where (select array_agg(x order by x) from jsonb_object_keys(r) x) <> array['at', 'error', 'id', 'stuck', 'user_id']),
  'a row carries ids, the time and the error text only');

select * from finish();
rollback;
