-- C3 (20270112030000): a post the plan marks gets an image once the founder approves it: one build_post_image order
-- for the Post image squad, with the post, its title and its platform. A post not marked, a paused CMO, a second
-- approval and an image already made order nothing; founders cannot set the mark.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

select ok(not has_column_privilege('authenticated', 'public.content_items', 'wants_image', 'update'), 'founders cannot set the mark');

insert into auth.users (id, email) values ('e2750000-0000-4000-8000-00000000000a', 'pi-a@test.local');
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e2751000-0000-4000-8000-00000000000a', 'e2750000-0000-4000-8000-00000000000a', 'plan_week', 'running');
select is(public.cmo_plan_week('e2750000-0000-4000-8000-00000000000a', 'e2751000-0000-4000-8000-00000000000a', jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'LinkedIn', 'day', current_date, 'idea', 'We shipped the editor', 'reason', 'Launch', 'image', true),
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date, 'idea', 'A plain thought', 'reason', 'r', 'image', false),
  jsonb_build_object('department', 'sales', 'platform', 'Reddit', 'day', current_date, 'idea', 'Threads', 'reason', 'r', 'image', true))), 3,
  'three calendar items');
select is((select string_agg(idea || '=' || wants_image, ', ' order by idea) from public.content_items where user_id = 'e2750000-0000-4000-8000-00000000000a'),
  'A plain thought=false, Threads=false, We shipped the editor=true', 'only the marked post wants an image');

update public.content_items set status = 'approved' where user_id = 'e2750000-0000-4000-8000-00000000000a' and department = 'post';
select is((select count(*)::int from public.work_orders where user_id = 'e2750000-0000-4000-8000-00000000000a' and kind = 'build_post_image'), 1,
  'approving the posts orders one image');
select is((select department || ' ' || status || ' ' || (brief->>'title') || ' ' || (brief->>'platform') || ' ' || (brief->>'postId')
  from public.work_orders where user_id = 'e2750000-0000-4000-8000-00000000000a' and kind = 'build_post_image'),
  'studio queued We shipped the editor linkedin ' || (select id from public.content_items where idea = 'We shipped the editor'),
  'for the marked post, on its platform, queued for the squad');

update public.content_items set status = 'in_review' where idea = 'We shipped the editor';
update public.content_items set status = 'approved' where idea = 'We shipped the editor';
select is((select count(*)::int from public.work_orders where user_id = 'e2750000-0000-4000-8000-00000000000a' and kind = 'build_post_image'), 1,
  'approved again: still one image');

update public.work_orders set status = 'cancelled' where user_id = 'e2750000-0000-4000-8000-00000000000a' and kind = 'build_post_image';
update public.profiles set cmo_paused_at = now() where id = 'e2750000-0000-4000-8000-00000000000a';
update public.content_items set status = 'in_review' where idea = 'We shipped the editor';
update public.content_items set status = 'approved' where idea = 'We shipped the editor';
select is((select count(*)::int from public.work_orders where user_id = 'e2750000-0000-4000-8000-00000000000a' and kind = 'build_post_image'
  and status <> 'cancelled'), 0, 'a paused CMO orders none');

select * from finish();
rollback;
