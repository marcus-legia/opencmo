-- 20270120050000: the week plan no longer orders a CMO-built slideshow (D7, 2026-11-12); a video script still gets its
-- brief order.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(3);

insert into auth.users (id, email) values ('e3050000-0000-4000-8000-00000000000a', 'slides@test.local');
update public.profiles set plan = 'starter', credit_balance = 50, timezone = 'UTC' where id = 'e3050000-0000-4000-8000-00000000000a';
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e3051000-0000-4000-8000-00000000000a', 'e3050000-0000-4000-8000-00000000000a', 'plan_week', 'running');

select is(public.cmo_plan_week('e3050000-0000-4000-8000-00000000000a', 'e3051000-0000-4000-8000-00000000000a', jsonb_build_array(
  jsonb_build_object('department', 'video', 'platform', 'Slideshow', 'day', current_date + 1, 'idea', 'Five cuts in five slides', 'reason', 'r'),
  jsonb_build_object('department', 'video', 'platform', 'TikTok', 'day', current_date + 2, 'idea', 'A script to record', 'reason', 'r'))), 2,
  'two calendar items');
select is((select count(*)::int from public.work_orders where user_id = 'e3050000-0000-4000-8000-00000000000a'
  and kind in ('write_slides', 'build_slideshow')), 0, 'a Slideshow item orders no slides and no slideshow');
select is((select count(*)::int from public.work_orders where user_id = 'e3050000-0000-4000-8000-00000000000a'
  and kind = 'write_video_brief'), 1, 'the video script still gets its brief');

select * from finish();
rollback;
