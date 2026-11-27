-- 20270207040000: cmo_news_skip_item, cmo_day_fill_idea and cmo_news_reserve change a planned post for its own running
-- draft only; a reserve refuses news another recent post holds or rode.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(32);

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

-- Reserving a story: the first draft takes it, a second post of the founder is refused, by news key or by story id.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3680000-0000-4000-8000-0000000000c6', 'e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Wave one', 'planned', '{"slot": 0}'),
  ('e3680000-0000-4000-8000-0000000000c7', 'e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Wave one too', 'planned', '{"slot": 1}');
insert into public.content_items (user_id, department, platform, day, idea, status, body) values
  ('e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date - 5, 'Overdue, drafted today', 'in_review',
    jsonb_build_object('news', jsonb_build_object('topicKey', 'ai-jobs', 'storyId', '11', 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))),
  ('e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Drafted long ago, approved today', 'approved',
    jsonb_build_object('news', jsonb_build_object('topicKey', 'old-news', 'storyId', '12', 'at', to_char((now() - interval '10 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))),
  ('e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Failed', 'failed',
    jsonb_build_object('news', jsonb_build_object('topicKey', 'failed-ride', 'storyId', '13', 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
insert into public.cmo_runs (id, user_id, kind, status, input) values
  ('e3680000-0000-4000-8000-0000000000d9', 'e3680000-0000-4000-8000-00000000000a', 'post_draft', 'running', '{"item_id": "e3680000-0000-4000-8000-0000000000c6"}'),
  ('e3680000-0000-4000-8000-0000000000da', 'e3680000-0000-4000-8000-00000000000a', 'post_draft', 'running', '{"item_id": "e3680000-0000-4000-8000-0000000000c7"}');

create function pg_temp.reserve(p_topic text, p_story text) returns boolean language sql as $$
  select public.cmo_news_reserve('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000da', 'e3680000-0000-4000-8000-0000000000c7', p_topic, p_story);
$$;

select ok(not has_function_privilege('authenticated', 'public.cmo_news_taken(uuid)', 'execute'), 'founders cannot read what is taken');
select is(public.cmo_news_reserve('e3680000-0000-4000-8000-00000000000a', 'e3680000-0000-4000-8000-0000000000d9', 'e3680000-0000-4000-8000-0000000000c6', 'claude-release', '21'), true,
  'the first draft reserves the story');
select is(pg_temp.reserve('claude-release', '22'), false, 'a second draft of the same wave is refused the same news');
select is(pg_temp.reserve('claude-model-launch', '21'), false, 'or the same story under another key');
select is(pg_temp.reserve('ai-jobs', '31'), false, 'news an overdue post rode today is taken, whatever its planned day');
select is(pg_temp.reserve('old-news', '32'), true, 'a post drafted ten days ago and approved today has not taken its news again');
select is(pg_temp.reserve('failed-ride', '33'), true, 'a failed post never rode its news');
select ok((public.cmo_news_taken('e3680000-0000-4000-8000-00000000000a')->'stories') ? '21', 'the draft leaves the held story out before it asks');

update public.cmo_runs set status = 'failed' where id = 'e3680000-0000-4000-8000-0000000000d9';
select is(pg_temp.reserve('claude-release', '21'), true, 'a hold ends with its run: a failed draft holds nothing');
update public.cmo_runs set status = 'running', lease_until = now() - interval '1 minute' where id = 'e3680000-0000-4000-8000-0000000000d9';
update public.content_items set body = body || jsonb_build_object('news_topic', 'long-write', 'news_story', '42',
    'news_topic_at', to_char((now() - interval '5 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  where id = 'e3680000-0000-4000-8000-0000000000c6';
select is(pg_temp.reserve('long-write', '42'), false, 'a running draft whose lease lapsed in a long write still holds for 15 minutes');
update public.content_items set body = body || '{"news_topic": "stale-hold", "news_story": "41", "news_topic_at": "2020-01-01T00:00:00Z"}' where id = 'e3680000-0000-4000-8000-0000000000c6';
select is(pg_temp.reserve('stale-hold', '41'), true, 'a hold on a dead lease, reserved long ago, holds nothing');
-- A bad stored time never breaks the lookup.
insert into public.content_items (user_id, department, platform, day, idea, status, body) values
  ('e3680000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Bad time', 'in_review', '{"news": {"topicKey": "bad-time", "storyId": "51", "at": "2026-13-40T99:00:00Z"}}');
select lives_ok($$ select public.cmo_news_taken('e3680000-0000-4000-8000-00000000000a') $$, 'a malformed time does not break what is taken');
select ok((public.cmo_news_taken('e3680000-0000-4000-8000-00000000000a')->'keys') ? 'bad-time', 'and the post counts from its last change');
select throws_ok($$ select pg_temp.reserve('Not A Key', '1') $$, '22023', null, 'a news key is a slug');
select throws_ok($$ select pg_temp.reserve('ok-key', 'abc') $$, '22023', null, 'a story id is digits');

select * from finish();
rollback;
