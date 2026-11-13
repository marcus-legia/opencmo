-- cmo-review B2.2 (20270106020000): the brain's video scripts are one minute (a script since 2026-11-09). B2.3's
-- write_slides → build_slideshow was removed on 2026-11-12 (20270120050000, D7): a Slideshow item orders nothing.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(6);

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

select is((select count(*)::int from public.work_orders where user_id = 'e2460000-0000-4000-8000-00000000000a'
  and kind in ('write_slides', 'build_slideshow')), 0, 'a Slideshow item orders no slides and no slideshow (D7)');

select * from finish();
rollback;
