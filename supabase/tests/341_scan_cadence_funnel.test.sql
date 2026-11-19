-- Wave 3 A5 (20270201040000): the scan cadence is saved and kept when not sent; my_funnel counts found, replied,
-- answered back and signed up per source in the window, only the founder's own people.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(11);

insert into auth.users (id, email) values
  ('e3410000-0000-4000-8000-00000000000a', 'fun-a@test.local'),
  ('e3410000-0000-4000-8000-00000000000b', 'fun-b@test.local');

select ok(not exists (select 1 from pg_proc where proname = 'sales_settings_save' and pronargs = 3), 'the three-argument save is gone');
select ok(not has_function_privilege('anon', 'public.my_funnel(integer)', 'execute'), 'signed-out visitors cannot read a funnel');

insert into public.opportunities (user_id, platform, url, community, title, score, reply, created_at, replied_at, status_at, person_status) values
  -- A: two found this week on Reddit, one replied and answered back; one HN signed up; one old and quiet.
  ('e3410000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/1/x/', 'a', 'T', 70, '', now() - interval '2 days', now() - interval '1 day', now() - interval '1 hour', 'answered_back'),
  ('e3410000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/2/x/', 'a', 'T', 70, '', now() - interval '3 days', null, null, 'found'),
  ('e3410000-0000-4000-8000-00000000000a', 'hn', 'https://news.ycombinator.com/item?id=1', '', 'T', 70, '', now() - interval '20 days', now() - interval '6 days', now() - interval '2 days', 'signed_up'),
  ('e3410000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/3/x/', 'a', 'T', 70, '', now() - interval '30 days', null, null, 'found'),
  ('e3410000-0000-4000-8000-00000000000b', 'reddit', 'https://www.reddit.com/r/b/comments/1/x/', 'b', 'T', 70, '', now(), now(), now(), 'customer');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3410000-0000-4000-8000-00000000000a"}';

select is((select cadence from public.sales_settings_save('{}', '[]')), 'mwf', 'Mon/Wed/Fri by default');
select is((select cadence from public.sales_settings_save('{}', '[]', null, 'weekdays')), 'weekdays', 'weekdays saved');
select is((select cadence from public.sales_settings_save('{}', '[]', array['reddit'])), 'weekdays', 'a save without a cadence keeps it');
select throws_ok($$ select public.sales_settings_save('{}', '[]', null, 'daily') $$, '22023',
  'Scan on Monday, Wednesday and Friday, on weekdays, or on Mondays.', 'an unknown cadence is refused');

select is((select string_agg(source || ':' || found || '/' || replied || '/' || answered_back || '/' || signed_up, ', ') from public.my_funnel()),
  'all:2/2/2/1, reddit:2/1/1/0, hn:0/1/1/1', 'per source and all, in the last 7 days');
select is((select found from public.my_funnel(60) where source = 'all'), 4, 'a longer window counts older finds');
select throws_ok($$ select * from public.my_funnel(0) $$, '22023', 'Pick 1 to 90 days.', 'the window is 1 to 90 days');

set local request.jwt.claims = '{"sub":"e3410000-0000-4000-8000-00000000000b"}';
select is((select string_agg(source || ':' || signed_up, ', ') from public.my_funnel()), 'all:1, reddit:1', 'another founder sees only their own');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3410000-0000-4000-8000-0000000000ff"}';
select is((select string_agg(source || ':' || found, ', ') from public.my_funnel()), 'all:0', 'no people: one empty row');

select * from finish();
rollback;
