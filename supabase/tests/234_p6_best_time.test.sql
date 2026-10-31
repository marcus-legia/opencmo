-- P6 A2 (20270101120000): best hours only after ten published posts with numbers on a platform, in the founder's
-- local time; the picker tries them instead of the defaults, and still keeps the gap and the daily cap.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(11);

select ok(not has_function_privilege('authenticated', 'public.best_slots_refresh(uuid)', 'execute'), 'only the job refreshes best hours');
select ok(not has_function_privilege('authenticated', 'public.schedule_candidate_times(uuid,text)', 'execute'), 'the candidates are internal');

insert into auth.users (id, email) values ('e2340000-0000-4000-8000-00000000000a', 'p6best@test.local');
-- UTC+7: a post at 07:00 UTC is a 14:00 post for this founder.
update public.profiles set timezone = 'Asia/Ho_Chi_Minh' where id = 'e2340000-0000-4000-8000-00000000000a';

-- Nine X posts: six at 14:00 local (many views), three at 09:00 local (few). Threads: three posts.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body, published_at)
select ('e2342000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'e2340000-0000-4000-8000-00000000000a', 'post',
  case when g <= 9 then 'X' else 'Threads' end, current_date - g, 'Post ' || g, 'published', '{"text":"x"}',
  date_trunc('day', now() - make_interval(days => g)) + case when g <= 6 then interval '7 hours' else interval '2 hours' end
from generate_series(1, 12) g;
insert into public.post_metrics (user_id, item_id, url, views, source)
select 'e2340000-0000-4000-8000-00000000000a', id, '', case when published_at::time = '07:00' then 1000 + extract(day from published_at)::int else 50 end, 'public'
from public.content_items where user_id = 'e2340000-0000-4000-8000-00000000000a';

select is(public.best_slots_refresh('e2340000-0000-4000-8000-00000000000a'), 0, 'nine posts are not enough');
select is(public.schedule_candidate_times('e2340000-0000-4000-8000-00000000000a', 'x'), array['09:00'], 'the defaults until then');

-- The tenth X post, at 09:00 local; an older reading of a post does not count, its newest does.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body, published_at) values
  ('e2342000-0000-4000-8000-000000000099', 'e2340000-0000-4000-8000-00000000000a', 'post', 'X', current_date - 20, 'Post 99', 'published',
   '{"text":"x"}', date_trunc('day', now() - interval '20 days') + interval '2 hours');
insert into public.post_metrics (user_id, item_id, url, views, source, measured_at) values
  ('e2340000-0000-4000-8000-00000000000a', 'e2342000-0000-4000-8000-000000000099', '', 90000, 'public', now() - interval '10 days'),
  ('e2340000-0000-4000-8000-00000000000a', 'e2342000-0000-4000-8000-000000000099', '', 60, 'public', now());

select is(public.best_slots_refresh('e2340000-0000-4000-8000-00000000000a'), 2, 'ten posts: two hours with two or more posts');
select is((select array_agg(hour order by median_views_per_hour desc) from public.best_slots
  where user_id = 'e2340000-0000-4000-8000-00000000000a' and platform = 'x'), array[14, 9]::smallint[], 'local hours, best first');
select is((select count(*)::int from public.best_slots where user_id = 'e2340000-0000-4000-8000-00000000000a' and platform = 'threads'), 0,
  'Threads keeps the defaults');
select is(public.schedule_candidate_times('e2340000-0000-4000-8000-00000000000a', 'x'), array['14:00'],
  'X tries its best hour, as many as the defaults offer');
select is(public.schedule_candidate_times('e2340000-0000-4000-8000-00000000000a', 'threads'), array['09:00', '12:00'], 'Threads its defaults');

-- The picker lands on 14:00 local, and moves a day on when a post already sits within the gap.
create temp table picked (at timestamptz) on commit drop;
insert into picked select public.schedule_pick_time('e2340000-0000-4000-8000-00000000000a', 'x', null);
select is((select to_char(at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') from picked), '14:00', 'the best hour is picked');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e2341000-0000-4000-8000-00000000000a', 'e2340000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date, 'post_draft', 'Posts', '{}', 'writer', 'done');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2342000-0000-4000-8000-0000000000aa', 'e2340000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Next', 'in_review', '{"text":"x"}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2343000-0000-4000-8000-00000000000a', 'e2340000-0000-4000-8000-00000000000a', 'e2341000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2342000-0000-4000-8000-0000000000aa', 'ready');
insert into public.schedule_slots (user_id, deliverable_id, platform, mode, publish_at, window_ends_at, status)
select 'e2340000-0000-4000-8000-00000000000a', 'e2343000-0000-4000-8000-00000000000a', 'x', 'intent', at + interval '1 hour', at + interval '75 minutes', 'waiting' from picked;
select is(public.schedule_pick_time('e2340000-0000-4000-8000-00000000000a', 'x', null), (select at + interval '1 day' from picked),
  'the gap still holds: the next day at the best hour');

select * from finish();
rollback;
