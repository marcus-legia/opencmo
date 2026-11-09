-- cmo-review B2.2 + B2.3 (20270106020000): the brain's video scripts are one minute (a script since 2026-11-09), and a Slideshow item in the
-- plan becomes write_slides → build_slideshow, dropped again when a replan drops it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

select is(public.cmo_video_seconds(), 60, 'videos are one minute (owner D4)');
select ok(not has_function_privilege('authenticated', 'public.cmo_video_seconds()', 'execute'), 'an internal constant');

insert into auth.users (id, email) values ('e2460000-0000-4000-8000-00000000000a', 'b23@test.local');
update public.profiles set weekly_credit_budget = 100, credit_balance = 50 where id = 'e2460000-0000-4000-8000-00000000000a';
-- Fresh niche research, so the script starts at once.
insert into public.cmo_insights (user_id, kind, body) values ('e2460000-0000-4000-8000-00000000000a', 'niche_video', '{}');
create temp table t (name text primary key, id uuid) on commit drop;
with r as (insert into public.cmo_runs (user_id, kind, status) values ('e2460000-0000-4000-8000-00000000000a', 'plan_week', 'running') returning id)
insert into t select 'run', id from r;

select is(public.cmo_plan_week('e2460000-0000-4000-8000-00000000000a', (select id from t where name = 'run'), jsonb_build_array(
  jsonb_build_object('department', 'video', 'platform', 'Shorts', 'day', current_date + 1, 'idea', 'How the CMO plans a week'),
  jsonb_build_object('department', 'video', 'platform', 'Slideshow', 'day', current_date + 2, 'idea', 'Five ways to cut a demo',
    'reason', 'Your pillar on editing'))), 2, 'a video and a slideshow on the calendar');

select is((select (input->>'seconds')::int from public.cmo_runs where user_id = 'e2460000-0000-4000-8000-00000000000a' and kind = 'write_video_brief'),
  60, 'the video''s script asks for one minute');
select is((select count(*)::int from public.work_orders where user_id = 'e2460000-0000-4000-8000-00000000000a' and kind in ('write_video_brief', 'build_video')),
  1, 'the slideshow is not a second script, and nothing builds a video');

insert into t select 'slides', id from public.work_orders where user_id = 'e2460000-0000-4000-8000-00000000000a' and kind = 'write_slides';
insert into t select 'show', id from public.work_orders where user_id = 'e2460000-0000-4000-8000-00000000000a' and kind = 'build_slideshow';
select isnt((select id from t where name = 'slides'), null, 'Writer gets a slides order');
select is((select brief->>'idea' || ' / ' || (brief->>'aspect') || ' / ' || (brief->>'platform') from public.work_orders where id = (select id from t where name = 'show')),
  'Five ways to cut a demo / 9:16 / TikTok', 'the slideshow order carries the idea');
select is((select depends_on from public.work_orders where id = (select id from t where name = 'show')),
  array[(select id from t where name = 'slides')], 'and waits on the slides');
select is((select count(*)::int from public.cmo_runs where user_id = 'e2460000-0000-4000-8000-00000000000a' and kind = 'write_slides'
             and input->>'order_id' = (select id from t where name = 'slides')::text), 1, 'the slides run is queued');
select is((select count(*)::int from public.studio_orders_claim()), 0, 'the squad waits until the slides are written');

-- A replan without the slideshow drops both orders and fails the queued slides run.
with r as (insert into public.cmo_runs (user_id, kind, status) values ('e2460000-0000-4000-8000-00000000000a', 'plan_week', 'running') returning id)
insert into t select 'run2', id from r;
select public.cmo_plan_week('e2460000-0000-4000-8000-00000000000a', (select id from t where name = 'run2'), jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date, 'idea', 'Cut by words')));
select is((select status from public.work_orders where id = (select id from t where name = 'show')), 'cancelled', 'the dropped slideshow is cancelled');
select is((select status from public.cmo_runs where kind = 'write_slides' and input->>'order_id' = (select id from t where name = 'slides')::text),
  'failed', 'and its slides are not written');

select * from finish();
rollback;
