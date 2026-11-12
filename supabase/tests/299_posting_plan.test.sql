-- 20270120010000: a founder saves their own posting plan; the bounds hold; nobody else can write it.
-- 20270120015000: the week plan keeps each post's targets, and saving a plan retargets the posts still only planned.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(23);

select ok(has_function_privilege('authenticated', 'public.save_posting_plan(jsonb)', 'execute'), 'a founder sets their own plan');
select ok(not has_function_privilege('anon', 'public.save_posting_plan(jsonb)', 'execute'), 'anon cannot');

insert into auth.users (id, email) values
  ('e2990000-0000-4000-8000-00000000000a', 'plan-a@test.local'),
  ('e2990000-0000-4000-8000-00000000000b', 'plan-b@test.local');
insert into public.profiles (id, email) values
  ('e2990000-0000-4000-8000-00000000000a', 'plan-a@test.local'),
  ('e2990000-0000-4000-8000-00000000000b', 'plan-b@test.local')
on conflict (id) do nothing;

select is((select posting_plan from public.profiles where id = 'e2990000-0000-4000-8000-00000000000a'), null, 'no plan until the founder chooses');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2990000-0000-4000-8000-00000000000a"}';

select lives_ok($$ select public.save_posting_plan('{"text":{"x":2,"threads":1,"linkedin":0,"facebook":0},"video":{"tiktok":3,"instagram":0,"youtube":7}}'::jsonb) $$, 'a valid plan is saved');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":4,"threads":1,"linkedin":0,"facebook":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', 'Posts a day must be between 0 and 3.', 'four posts a day is refused');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":1,"threads":1,"linkedin":0,"facebook":0},"video":{"tiktok":8,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', 'Videos a week must be between 0 and 7.', 'eight videos a week is refused');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":1,"threads":1,"linkedin":0,"facebook":0,"myspace":1},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', null, 'an unknown platform is refused');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":1.5,"threads":1,"linkedin":0,"facebook":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', null, 'half a post is refused');

reset role;
select is((select posting_plan->'text'->>'x' from public.profiles where id = 'e2990000-0000-4000-8000-00000000000a'), '2', 'the saved plan is stored; the refused ones changed nothing');
select is((select posting_plan from public.profiles where id = 'e2990000-0000-4000-8000-00000000000b'), null, 'another founder''s plan is untouched');

-- 20270120015000: the week plan writes each post's targets and slot into body; a bad list is dropped, not stored.
-- Slot 1 is sent before slot 0: one call's rows share created_at, so only body.slot can order them.
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e2991000-0000-4000-8000-00000000000a', 'e2990000-0000-4000-8000-00000000000a', 'plan_week', 'running');
select is(public.cmo_plan_week('e2990000-0000-4000-8000-00000000000a', 'e2991000-0000-4000-8000-00000000000a', jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('x'), 'slot', 1, 'day', current_date + 1, 'idea', 'Second slot', 'reason', 'r'),
  jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('x', 'linkedin'), 'slot', 0, 'day', current_date + 1, 'idea', 'First slot', 'reason', 'r'),
  jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('myspace'), 'slot', 0, 'day', current_date + 2, 'idea', 'Bad targets', 'reason', 'r'),
  jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('x'), 'slot', 0, 'day', current_date + 3, 'idea', 'Drafted already', 'reason', 'r'),
  jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('x'), 'slot', 0, 'day', current_date, 'idea', 'Due today', 'reason', 'r'),
  jsonb_build_object('department', 'sales', 'platform', 'Reddit', 'targets', jsonb_build_array('x'), 'slot', 0, 'day', current_date + 1, 'idea', 'Threads', 'reason', 'r'))), 6,
  'six calendar items');
select is((select string_agg(idea || '=' || coalesce(body->>'targets', '-') || '/' || coalesce(body->>'slot', '-'), ', ' order by idea) from public.content_items where user_id = 'e2990000-0000-4000-8000-00000000000a'),
  'Bad targets=-/-, Drafted already=["x"]/0, Due today=["x"]/0, First slot=["x", "linkedin"]/0, Second slot=["x"]/1, Threads=-/-',
  'posts keep their targets and slot; a bad list and a Reddit item get neither');
select lives_ok($$ select public.cmo_plan_week('e2990000-0000-4000-8000-00000000000b', 'e2991000-0000-4000-8000-00000000000a',
  (select jsonb_agg(jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('x'), 'day', current_date + (g % 7), 'idea', 'Slot ' || g, 'reason', 'r')) from generate_series(1, 49) g)) $$,
  'a full week (3 posts a day, 21 videos, 7 Reddit items) fits the plan''s limit');
delete from public.content_items where user_id = 'e2990000-0000-4000-8000-00000000000b';

update public.content_items set status = 'in_review', body = '{"text": "A draft", "targets": ["x"], "slot": 0}'
where user_id = 'e2990000-0000-4000-8000-00000000000a' and idea = 'Drafted already';

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2990000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.save_posting_plan('{"text":{"x":0,"threads":1,"linkedin":1,"facebook":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$, 'a new plan is saved');
reset role;

select is((select string_agg(idea || '=' || platform || ' ' || (body->>'targets'), ', ' order by idea) from public.content_items
  where user_id = 'e2990000-0000-4000-8000-00000000000a' and department = 'post' and status = 'planned' and day > current_date),
  'Bad targets=Threads ["threads", "linkedin"], First slot=Threads ["threads", "linkedin"], Second slot=Threads ["threads", "linkedin"]',
  'every planned post after today takes the new plan''s slot (capped at the last one) and the first target''s label');
select is((select platform || ' ' || (body->>'targets') from public.content_items where user_id = 'e2990000-0000-4000-8000-00000000000a' and idea = 'Drafted already'),
  'X ["x"]', 'a drafted post is left alone');
select is((select platform || ' ' || (body->>'targets') from public.content_items where user_id = 'e2990000-0000-4000-8000-00000000000a' and idea = 'Due today'),
  'X ["x"]', 'a post due today is left alone: its draft may be running');
select is((select body from public.content_items where user_id = 'e2990000-0000-4000-8000-00000000000a' and department = 'sales'),
  '{}'::jsonb, 'a Reddit item is left alone');

-- Slots of different width: the rank follows body.slot, not the insert order, on every save.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2990000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.save_posting_plan('{"text":{"x":2,"threads":1,"linkedin":0,"facebook":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$, 'X 2 + Threads 1 is saved');
reset role;
select is((select string_agg(idea || '=' || (body->>'targets') || '/' || (body->>'slot'), ', ' order by idea) from public.content_items
  where user_id = 'e2990000-0000-4000-8000-00000000000a' and day = current_date + 1 and department = 'post'),
  'First slot=["x", "threads"]/0, Second slot=["x"]/1', 'slot 0 takes the wide slot, slot 1 the narrow one');

-- A save that leaves the text section as it is retargets nothing (a hand-set list stays as it is).
update public.content_items set body = body || '{"targets": ["linkedin"]}' where user_id = 'e2990000-0000-4000-8000-00000000000a' and idea = 'Second slot';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2990000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.save_posting_plan('{"text":{"x":2,"threads":1,"linkedin":0,"facebook":0},"video":{"tiktok":1,"instagram":0,"youtube":0}}'::jsonb) $$, 'a video-only change is saved');
reset role;
select is((select body->>'targets' from public.content_items where user_id = 'e2990000-0000-4000-8000-00000000000a' and idea = 'Second slot'),
  '["linkedin"]', 'a video-only change leaves every post''s targets alone');
select is((select posting_plan->'video'->>'tiktok' from public.profiles where id = 'e2990000-0000-4000-8000-00000000000a'), '1', 'and the video change is stored');

select * from finish();
rollback;
