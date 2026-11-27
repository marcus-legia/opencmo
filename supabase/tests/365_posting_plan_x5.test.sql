-- 20270207010000: X takes 5 posts a day, the others 3; X has five default times; the week plan keeps slots 3 and 4,
-- a five-a-day week, and each post's news mode.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email) values ('e3630000-0000-4000-8000-00000000000a', 'x5@test.local');
insert into public.profiles (id, email) values ('e3630000-0000-4000-8000-00000000000a', 'x5@test.local')
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3630000-0000-4000-8000-00000000000a"}';

select lives_ok($$ select public.save_posting_plan('{"text":{"x":5,"threads":3,"linkedin":3,"facebook":3},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  'five on X and three on the others save');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":6,"threads":1,"linkedin":0,"facebook":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', 'X takes 0 to 5 posts a day; the others 0 to 3.', 'six on X is refused');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":1,"threads":4,"linkedin":0,"facebook":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', 'X takes 0 to 5 posts a day; the others 0 to 3.', 'four on Threads is refused');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":1,"threads":0,"linkedin":4,"facebook":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', 'X takes 0 to 5 posts a day; the others 0 to 3.', 'four on LinkedIn is refused');
reset role;

select is(public.schedule_rules()->'platforms'->'x', '{"times": ["09:00", "12:00", "15:00", "18:00", "21:00"], "dailyCap": 5}'::jsonb,
  'X has five default times, three hours apart');

-- A five-a-day week: 35 posts, 21 videos and 7 Reddit items (63, over the old limit of 60).
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e3631000-0000-4000-8000-00000000000a', 'e3630000-0000-4000-8000-00000000000a', 'plan_week', 'running');
select is(public.cmo_plan_week('e3630000-0000-4000-8000-00000000000a', 'e3631000-0000-4000-8000-00000000000a',
  (select jsonb_agg(jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('x'), 'slot', s,
            'day', current_date + 1 + d, 'idea', 'Post ' || d || '/' || s, 'reason', 'r',
            'news', case s when 0 then 'required' when 1 then 'none' when 2 then 'hook' when 3 then 'sometimes' end))
     from generate_series(0, 6) d, generate_series(0, 4) s)
  || (select jsonb_agg(jsonb_build_object('department', 'video', 'platform', 'TikTok', 'day', current_date + 1 + (g % 7), 'idea', 'Video ' || g, 'reason', 'r'))
      from generate_series(1, 21) g)
  || (select jsonb_agg(jsonb_build_object('department', 'sales', 'platform', 'Reddit', 'day', current_date + 1 + g, 'idea', 'Sales ' || g, 'reason', 'r'))
      from generate_series(0, 6) g)), 63, 'a week of five posts a day fits');
select throws_ok($$ select public.cmo_plan_week('e3630000-0000-4000-8000-00000000000a', 'e3631000-0000-4000-8000-00000000000a',
  (select jsonb_agg(jsonb_build_object('department', 'sales', 'platform', 'Reddit', 'day', current_date + 1, 'idea', 'S', 'reason', 'r')) from generate_series(1, 81))) $$,
  '22023', 'This plan is not valid.', 'more than 80 items is still refused');

select is((select string_agg(distinct body->>'slot', ',' order by body->>'slot') from public.content_items
  where user_id = 'e3630000-0000-4000-8000-00000000000a' and department = 'post'), '0,1,2,3,4', 'slots 3 and 4 are kept');
select is((select string_agg(distinct coalesce(body->>'news', '-'), ',' order by coalesce(body->>'news', '-')) from public.content_items
  where user_id = 'e3630000-0000-4000-8000-00000000000a' and department = 'post'), '-,hook,none,required',
  'each post keeps its news mode; an unknown word and a missing one are dropped');
select is((select count(*)::int from public.content_items where user_id = 'e3630000-0000-4000-8000-00000000000a' and department <> 'post' and body ? 'news'),
  0, 'only posts carry a news mode');

-- Saving a narrower plan retargets the five slots of each day onto the new plan (slots above the last one cap to it).
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3630000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.save_posting_plan('{"text":{"x":5,"threads":2,"linkedin":0,"facebook":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  'a narrower plan is saved');
reset role;
select is((select string_agg((body->>'slot') || '=' || (body->>'targets'), ', ' order by (body->>'slot')::int) from public.content_items
  where user_id = 'e3630000-0000-4000-8000-00000000000a' and department = 'post' and day = current_date + 1),
  '0=["x", "threads"], 1=["x", "threads"], 2=["x"], 3=["x"], 4=["x"]', 'retargeting still works over five slots');

select * from finish();
rollback;
