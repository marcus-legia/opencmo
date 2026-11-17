-- Uploads published with a fallback, and the grouping the hourly alert shares with the owner's page (20270130010000):
-- warnings show for the owner and not for a founder, owner accounts are left out, only short codes count, the window
-- holds, and `ops_failure_groups` answers `service_role` only. The codes are unique to this file, so the test holds on
-- a database that already has warnings.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

select ok(not has_function_privilege('anon', 'public.ops_failure_groups(timestamptz)', 'execute'), 'anon cannot call the grouping');
select ok(not has_function_privilege('authenticated', 'public.ops_failure_groups(timestamptz)', 'execute'), 'a signed-in user cannot call the grouping');
select ok(has_function_privilege('service_role', 'public.ops_failure_groups(timestamptz)', 'execute'), 'the alert cron (service_role) can');

insert into auth.users (id, email, created_at) values
  ('e3250000-0000-4000-8000-0000000000ff', 'warnings-owner@test.local', now() - interval '30 days'),
  ('e3250000-0000-4000-8000-00000000000a', 'warnings-a@test.local', now() - interval '30 days'),
  ('e3250000-0000-4000-8000-00000000000b', 'warnings-b@test.local', now() - interval '30 days');
insert into public.app_owners (email) values ('warnings-owner@test.local');

-- a and b each had a transcript fail; a's also lost its face detector and repeats the code once; the owner's upload is
-- left out; a's old one is outside the week; a manifest with a sentence instead of a code, and one whose warnings are
-- not a list, count for nothing.
insert into public.jobs (id, user_id, source_url, status, finished_at, media_manifest) values
  ('e3251000-0000-4000-8000-00000000000a', 'e3250000-0000-4000-8000-00000000000a', 'https://a', 'done', now() - interval '3 hours',
    '{"warnings": ["zq_transcript_failed", "zq_framing_centre_no_detector", "zq_transcript_failed"]}'),
  ('e3251000-0000-4000-8000-00000000000b', 'e3250000-0000-4000-8000-00000000000b', 'https://b', 'done', now() - interval '1 hour',
    '{"warnings": ["zq_transcript_failed"]}'),
  ('e3251000-0000-4000-8000-0000000000ff', 'e3250000-0000-4000-8000-0000000000ff', 'https://o', 'done', now() - interval '1 hour',
    '{"warnings": ["zq_transcript_failed"]}'),
  ('e3251000-0000-4000-8000-0000000000a0', 'e3250000-0000-4000-8000-00000000000a', 'https://old', 'done', now() - interval '20 days',
    '{"warnings": ["zq_transcript_failed"]}'),
  ('e3251000-0000-4000-8000-0000000000b1', 'e3250000-0000-4000-8000-00000000000b', 'https://b1', 'done', now() - interval '1 hour',
    '{"warnings": ["Zq Scribe said 401 for key sk_live_x"]}'),
  ('e3251000-0000-4000-8000-0000000000b2', 'e3250000-0000-4000-8000-00000000000b', 'https://b2', 'done', now() - interval '1 hour',
    '{"warnings": "zq_not_a_list"}');

create function pg_temp.report(p int) returns jsonb language sql as $f$ select public.ops_failures_report(p) $f$;
grant execute on function pg_temp.report(int) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3250000-0000-4000-8000-00000000000a","email":"warnings-a@test.local"}';
select throws_ok($$ select public.ops_failures_report(7) $$, '42501', 'Not available.', 'a founder cannot read the warnings');
select throws_ok($$ select public.ops_failure_groups(now() - interval '1 hour') $$, '42501', null, 'a founder cannot call the grouping');

set local request.jwt.claims = '{"sub":"e3250000-0000-4000-8000-0000000000ff","email":"warnings-owner@test.local"}';
create temp table week on commit drop as select pg_temp.report(7) as j;
create temp table month on commit drop as select pg_temp.report(30) as j;
reset role;

create function pg_temp.warning(j jsonb, c text) returns jsonb language sql as $f$
  select w from jsonb_array_elements(j->'warnings') w where w->>'code' = c
$f$;

select is(pg_temp.warning((select j from week), 'zq_transcript_failed')->>'jobs', '2',
  'a and b: one job each (a code repeated in one manifest counts once), the owner is left out');
select is(pg_temp.warning((select j from week), 'zq_transcript_failed')->>'accounts', '2', 'it hit two accounts');
select is(pg_temp.warning((select j from month), 'zq_transcript_failed')->>'jobs', '3', 'a 30-day window takes a''s older upload too');
select is(pg_temp.warning((select j from week), 'zq_transcript_failed')->'latest',
  '["e3251000-0000-4000-8000-00000000000b", "e3251000-0000-4000-8000-00000000000a"]'::jsonb, 'the latest job ids, newest first');
select is(pg_temp.warning((select j from week), 'zq_framing_centre_no_detector')->>'jobs', '1', 'a second code on the same job is its own row');
select ok(
  not exists (select 1 from jsonb_array_elements((select j from month)->'warnings') w
    where w->>'code' ilike '%zq%' and w->>'code' not in ('zq_transcript_failed', 'zq_framing_centre_no_detector')),
  'a sentence or a warnings field that is not a list counts for nothing');
select ok(
  not exists (select 1 from jsonb_array_elements((select j from month)->'warnings') w
    where (select array_agg(x order by x) from jsonb_object_keys(w) x) <> array['accounts', 'code', 'first_seen', 'jobs', 'last_seen', 'latest']),
  'a warning carries the code, counts, times and job ids only');

-- The alert reads the same grouping as the page.
set local role service_role;
create temp table alert on commit drop as select public.ops_failure_groups(now() - interval '7 days') as j;
reset role;
select is((select j->'warnings' from alert), (select j->'warnings' from week), 'the alert and the page see the same warnings');
select is((select j->'groups' from alert), (select j->'groups' from week), 'and the same failure groups');

select * from finish();
rollback;
