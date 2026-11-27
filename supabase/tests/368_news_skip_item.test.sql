-- 20270207040000: cmo_news_skip_item skips a planned post for its own running draft only.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(11);

select ok(not has_function_privilege('authenticated', 'public.cmo_news_skip_item(uuid,uuid,uuid)', 'execute'), 'founders cannot skip through it');
select ok(has_function_privilege('service_role', 'public.cmo_news_skip_item(uuid,uuid,uuid)', 'execute'), 'the runner can');

insert into auth.users (id, email) values
  ('e3680000-0000-4000-8000-00000000000a', 'news-skip-a@test.local'),
  ('e3680000-0000-4000-8000-00000000000b', 'news-skip-b@test.local');
insert into public.profiles (id, email) values
  ('e3680000-0000-4000-8000-00000000000a', 'news-skip-a@test.local'),
  ('e3680000-0000-4000-8000-00000000000b', 'news-skip-b@test.local')
on conflict (id) do nothing;

insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3680000-0000-4000-8000-0000000000c1', 'e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Ride the news', 'planned', '{"slot": 0, "news": "required"}'),
  ('e3680000-0000-4000-8000-0000000000c2', 'e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Drafted', 'in_review', '{"slot": 1}'),
  ('e3680000-0000-4000-8000-0000000000c3', 'e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Other run', 'planned', '{"slot": 2}');

insert into public.cmo_runs (id, user_id, kind, status, input) values
  ('e3680000-0000-4000-8000-0000000000d1', 'e3680000-0000-4000-8000-00000000000a', 'post_draft', 'running', '{"item_id": "e3680000-0000-4000-8000-0000000000c1"}'),
  ('e3680000-0000-4000-8000-0000000000d2', 'e3680000-0000-4000-8000-00000000000a', 'post_draft', 'running', '{"item_id": "e3680000-0000-4000-8000-0000000000c2"}'),
  ('e3680000-0000-4000-8000-0000000000d3', 'e3680000-0000-4000-8000-00000000000b', 'post_draft', 'running', '{"item_id": "e3680000-0000-4000-8000-0000000000c3"}'),
  ('e3680000-0000-4000-8000-0000000000d4', 'e3680000-0000-4000-8000-00000000000a', 'post_draft', 'done', '{"item_id": "e3680000-0000-4000-8000-0000000000c3"}'),
  ('e3680000-0000-4000-8000-0000000000d5', 'e3680000-0000-4000-8000-00000000000a', 'plan_week', 'running', '{"item_id": "e3680000-0000-4000-8000-0000000000c3"}'),
  ('e3680000-0000-4000-8000-0000000000d6', 'e3680000-0000-4000-8000-00000000000a', 'post_draft', 'running', '{"source": "schedule"}');

select is(public.cmo_news_skip_item('e3680000-0000-4000-8000-00000000000b', 'e3680000-0000-4000-8000-0000000000d3', 'e3680000-0000-4000-8000-0000000000c3'), false,
  'another founder cannot skip it');
select is(public.cmo_news_skip_item('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d1', 'e3680000-0000-4000-8000-0000000000c3'), false,
  'a run cannot skip an item it does not name');
select is(public.cmo_news_skip_item('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d2', 'e3680000-0000-4000-8000-0000000000c2'), false,
  'a post no longer planned is left alone');
select is(public.cmo_news_skip_item('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d1', 'e3680000-0000-4000-8000-0000000000c1'), true,
  'its own running draft skips it');
select is((select status || ':' || (body->>'skip_reason') || ':' || (body->>'news') from public.content_items where id = 'e3680000-0000-4000-8000-0000000000c1'),
  'skipped:no_news:required', 'skipped with the reason, the plan kept');
select is((select status from public.content_items where id = 'e3680000-0000-4000-8000-0000000000c3'), 'planned', 'the other item is untouched');
select is(public.cmo_news_skip_item('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d4', 'e3680000-0000-4000-8000-0000000000c3'), false,
  'a finished run cannot skip');
select is(public.cmo_news_skip_item('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d5', 'e3680000-0000-4000-8000-0000000000c3'), false,
  'a run of another kind cannot skip');
select is(public.cmo_news_skip_item('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d6', 'e3680000-0000-4000-8000-0000000000c3'), true,
  'a running draft that names no item skips the post it drafted');

select * from finish();
rollback;
