-- 20270207040000: cmo_news_skip_item and cmo_day_fill_idea change a planned post for its own running draft only.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(17);

select ok(not has_function_privilege('authenticated', 'public.cmo_news_skip_item(uuid,uuid,uuid,text)', 'execute'), 'founders cannot skip through it');
select ok(has_function_privilege('service_role', 'public.cmo_news_skip_item(uuid,uuid,uuid,text)', 'execute'), 'the runner can');

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

select throws_ok($$ select public.cmo_news_skip_item('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d6', 'e3680000-0000-4000-8000-0000000000c3', 'bored') $$,
  '22023', null, 'an unknown reason is refused');

insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3680000-0000-4000-8000-0000000000c4', 'e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Today''s post, from your content plan', 'planned', '{"slot": 3, "planned_from": "day_fill"}'),
  ('e3680000-0000-4000-8000-0000000000c5', 'e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Planned by the week', 'planned', '{"slot": 4}');
insert into public.cmo_runs (id, user_id, kind, status, input) values
  ('e3680000-0000-4000-8000-0000000000d7', 'e3680000-0000-4000-8000-00000000000a', 'post_draft', 'running', '{"item_id": "e3680000-0000-4000-8000-0000000000c4"}'),
  ('e3680000-0000-4000-8000-0000000000d8', 'e3680000-0000-4000-8000-00000000000a', 'post_draft', 'running', '{"item_id": "e3680000-0000-4000-8000-0000000000c5"}');

select ok(not has_function_privilege('authenticated', 'public.cmo_day_fill_idea(uuid,uuid,uuid,text)', 'execute'), 'founders cannot set a fill idea');
select is(public.cmo_day_fill_idea('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d8', 'e3680000-0000-4000-8000-0000000000c5', 'New idea'), false,
  'a week-planned post keeps its idea');
select is(public.cmo_day_fill_idea('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d7', 'e3680000-0000-4000-8000-0000000000c4', '   '), false,
  'an empty idea changes nothing');
select is(public.cmo_day_fill_idea('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d7', 'e3680000-0000-4000-8000-0000000000c4', '  What we learned about pricing  '), true,
  'its own draft sets the fill idea');
select is((select idea from public.content_items where id = 'e3680000-0000-4000-8000-0000000000c4'), 'What we learned about pricing', 'trimmed and saved');

select * from finish();
rollback;
