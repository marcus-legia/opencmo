-- 20270207030000: x_news_stories is the service role's alone; the cleanup keeps two weeks.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

select ok(not has_table_privilege('authenticated', 'public.x_news_stories', 'select'), 'founders cannot read the stories');
select ok(not has_table_privilege('authenticated', 'public.x_news_stories', 'insert'), 'founders cannot write them');
select ok(not has_table_privilege('anon', 'public.x_news_stories', 'select'), 'anon cannot read them');
select ok(has_table_privilege('service_role', 'public.x_news_stories', 'insert'), 'the snapshot can write them');
select ok((select relrowsecurity from pg_class where oid = 'public.x_news_stories'::regclass), 'RLS is on');

select ok(not has_function_privilege('authenticated', 'public.x_news_purge(integer)', 'execute'), 'founders cannot purge');
select ok(has_function_privilege('service_role', 'public.x_news_purge(integer)', 'execute'), 'the cleanup can');

insert into public.x_news_stories (taken_at, story_id, name, relevant, topic_key) values
  (now() - interval '15 days', '1', 'Old story', true, 'old-story'),
  (now() - interval '1 hour', '2', 'New story', true, 'new-story');

select throws_ok(
  $$ insert into public.x_news_stories (taken_at, story_id, name) select taken_at, story_id, 'Again' from public.x_news_stories where story_id = '2' $$,
  '23505', null, 'a story is stored once per snapshot');
select throws_ok(
  $$ insert into public.x_news_stories (taken_at, story_id, name, topic_key) values (now(), '3', 'Bad key', 'Has Spaces') $$,
  '23514', null, 'a topic key is a short lowercase slug');

select throws_ok(
  $$ insert into public.x_news_stories (taken_at, story_id, name, relevant) values (now(), '4', 'No key', true) $$,
  '23514', null, 'a relevant story has a topic key');
select throws_ok($$ select public.x_news_purge(0) $$, '22023', null, 'a purge keeps at least one day');
select throws_ok($$ select public.x_news_purge(null) $$, '22023', null, 'a purge needs a number of days');

select is(public.x_news_purge(14), 1, 'the cleanup drops the story older than two weeks');
select is((select string_agg(story_id, ',') from public.x_news_stories where story_id in ('1', '2')), '2', 'and keeps the new one');

select * from finish();
rollback;
