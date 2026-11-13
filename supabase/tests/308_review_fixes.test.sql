-- 20270120070000: the fixes of the whole-branch review. A core post goes out on every platform (the first one to post
-- no longer cancels the rest); a core post is approved against the core limit; the purge can queue `captures` and
-- `photos`; one open photo draft; a script with a caption fits its order; a week of scripts can be queued; a new
-- slot keeps "post as a thread"; a Threads photo post takes 500 characters; a 4,000-character X post can be approved.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(24);

insert into auth.users (id, email) values ('e3080000-0000-4000-8000-00000000000a', 'fixes-a@test.local');
update public.profiles set plan = 'starter', credit_balance = 20, timezone = 'UTC' where id = 'e3080000-0000-4000-8000-00000000000a';
select public.zernio_profile_save('e3080000-0000-4000-8000-00000000000a', 'prof-fixes');
select public.social_account_save('e3080000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-fixes-x');
select public.social_account_save('e3080000-0000-4000-8000-00000000000a', 'linkedin', 'Founder', null, 'acc-fixes-li');
select public.social_account_save('e3080000-0000-4000-8000-00000000000a', 'threads', '@founder', null, 'acc-fixes-th');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3081000-0000-4000-8000-00000000000a', 'e3080000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'done');

-- 1. One core post, approved, for X and LinkedIn: two slots.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e3082000-0000-4000-8000-000000000001', 'e3080000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Core', 'approved',
  '{"text":"One core post.","targets":["x","linkedin"]}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
values ('e3083000-0000-4000-8000-000000000001', 'e3080000-0000-4000-8000-00000000000a', 'e3081000-0000-4000-8000-00000000000a', 'post',
  'content_item', 'e3082000-0000-4000-8000-000000000001', 'decided');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3083000-0000-4000-8000-000000000001'), 2, 'two slots, one a platform');
select public.publish_status((select id from public.schedule_slots where deliverable_id = 'e3083000-0000-4000-8000-000000000001' and platform = 'x'),
  'published', 'ext-x-1', 'https://x.com/founder/status/1');
select is((select status from public.schedule_slots where deliverable_id = 'e3083000-0000-4000-8000-000000000001' and platform = 'x'), 'published', 'X is live');
select ok((select status in ('proposed', 'waiting') from public.schedule_slots where deliverable_id = 'e3083000-0000-4000-8000-000000000001' and platform = 'linkedin'),
  'the LinkedIn slot is not cancelled when X posts');
select is((select status from public.content_items where id = 'e3082000-0000-4000-8000-000000000001'), 'approved', 'the post is not done while LinkedIn waits');
select public.publish_status((select id from public.schedule_slots where deliverable_id = 'e3083000-0000-4000-8000-000000000001' and platform = 'linkedin'),
  'published', 'ext-li-1', 'https://www.linkedin.com/feed/update/urn:li:activity:1');
select is((select status from public.content_items where id = 'e3082000-0000-4000-8000-000000000001'), 'published', 'the last platform makes the post published');

-- One platform posted, the founder cancels the other: the post is published, nothing is left to go out.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e3082000-0000-4000-8000-000000000007', 'e3080000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 1, 'Core two', 'approved',
  '{"text":"Another core post.","targets":["x","linkedin"]}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
values ('e3083000-0000-4000-8000-000000000007', 'e3080000-0000-4000-8000-00000000000a', 'e3081000-0000-4000-8000-00000000000a', 'post',
  'content_item', 'e3082000-0000-4000-8000-000000000007', 'decided');
select public.publish_status((select id from public.schedule_slots where deliverable_id = 'e3083000-0000-4000-8000-000000000007' and platform = 'x'),
  'published', 'ext-x-7', 'https://x.com/founder/status/7');
select is((select status from public.content_items where id = 'e3082000-0000-4000-8000-000000000007'), 'approved', 'one platform posted, one waits');
update public.schedule_slots set status = 'cancelled' where deliverable_id = 'e3083000-0000-4000-8000-000000000007' and platform = 'linkedin';
select is((select status from public.content_items where id = 'e3082000-0000-4000-8000-000000000007'), 'published', 'cancelling the rest settles the post');

-- 2. The purge's buckets.
select lives_ok($$ insert into public.storage_deletions (bucket, path, user_id) values
  ('captures', 'e3080000-0000-4000-8000-00000000000a/a.png', 'e3080000-0000-4000-8000-00000000000a'),
  ('photos', 'e3080000-0000-4000-8000-00000000000a/p/1.jpg', 'e3080000-0000-4000-8000-00000000000a') $$,
  'a deletion may name captures and photos');

-- 3 and 9. Approving against the right limit.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3082000-0000-4000-8000-000000000002', 'e3080000-0000-4000-8000-00000000000a', 'post', 'Threads', current_date, 'Core long', 'in_review',
   jsonb_build_object('text', rpad('', 1800, 'One true thing. '), 'targets', jsonb_build_array('threads', 'linkedin'))),
  ('e3082000-0000-4000-8000-000000000003', 'e3080000-0000-4000-8000-00000000000a', 'post', 'Threads', current_date, 'Core too long', 'in_review',
   jsonb_build_object('text', rpad('', 3001, 'One true thing. '), 'targets', jsonb_build_array('threads', 'linkedin'))),
  ('e3082000-0000-4000-8000-000000000004', 'e3080000-0000-4000-8000-00000000000a', 'post', 'LinkedIn', current_date, 'One platform', 'in_review',
   jsonb_build_object('text', rpad('', 3001, 'One true thing. '))),
  ('e3082000-0000-4000-8000-000000000005', 'e3080000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Long X', 'in_review',
   jsonb_build_object('text', rpad('', 4000, 'One true thing. ')));
set local request.jwt.claims = '{"sub":"e3080000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.cmo_decide_post('e3082000-0000-4000-8000-000000000002', 'approve') $$,
  'a core post of 1,800 characters is approved though Threads is its first platform');
select throws_ok($$ select public.cmo_decide_post('e3082000-0000-4000-8000-000000000003', 'approve') $$, '22023',
  'A post that goes to several platforms can be at most 3,000 characters.', 'a core post over the core limit is refused in words');
select throws_ok($$ select public.cmo_decide_post('e3082000-0000-4000-8000-000000000004', 'approve') $$, '22023',
  'Posts on LinkedIn can be at most 3,000 characters.', 'a post for one platform keeps that platform''s limit');
select lives_ok($$ select public.cmo_decide_post('e3082000-0000-4000-8000-000000000005', 'approve') $$, 'an X post of 4,000 characters is approved');
select is((select char_length(final_text) from public.content_items where id = 'e3082000-0000-4000-8000-000000000005'), 4000, 'and kept whole');

-- 4. One open photo draft.
set local role authenticated;
create temp table t_draft on commit drop as select public.photo_post_create() as id;
insert into t_draft select public.photo_post_create();
insert into t_draft select public.photo_post_create();
reset role;
select is((select count(distinct id)::int from t_draft), 1, 'starting a photo post again hands back the open draft');
select is((select count(*)::int from public.photo_posts where user_id = 'e3080000-0000-4000-8000-00000000000a' and status = 'draft'), 1, 'one draft, however often it is started');

-- 5. A long script with its caption fits its order.
select lives_ok($$ update public.work_orders set brief = jsonb_build_object('caption', repeat('c', 2200), 'storyboard', repeat('s', 3600))
  where id = 'e3081000-0000-4000-8000-00000000000a' $$, 'a brief of about 6 KB is kept');
select throws_ok($$ update public.work_orders set brief = jsonb_build_object('storyboard', repeat('s', 8200))
  where id = 'e3081000-0000-4000-8000-00000000000a' $$, '23514', null, 'the brief is still capped');

-- 6. A full week of scripts can be queued on the day it is planned.
select ok(public.cmo_job_daily_limit('write_video_brief') >= 21, 'seven scripts a week on three platforms fit in a day');

-- 7. A new slot keeps "post as a thread".
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e3082000-0000-4000-8000-000000000006', 'e3080000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Thread it', 'approved',
  jsonb_build_object('text', rpad('', 600, 'One true thing. ')));
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
values ('e3083000-0000-4000-8000-000000000006', 'e3080000-0000-4000-8000-00000000000a', 'e3081000-0000-4000-8000-00000000000a', 'post',
  'content_item', 'e3082000-0000-4000-8000-000000000006', 'decided');
update public.schedule_slots set status = 'missed', options = '{"as_thread": true}'
where deliverable_id = 'e3083000-0000-4000-8000-000000000006';
update public.approvals set status = 'cancelled', decided_at = now()
where ref_kind = 'schedule_slot' and ref_id in (select id from public.schedule_slots where deliverable_id = 'e3083000-0000-4000-8000-000000000006');
select is(public.schedule_propose('e3083000-0000-4000-8000-000000000006'), 1, 'the missed post gets a new slot');
select is((select options->>'as_thread' from public.schedule_slots where deliverable_id = 'e3083000-0000-4000-8000-000000000006' and status = 'proposed'),
  'true', 'which still goes out as a thread');
select is((select options from public.schedule_slots where deliverable_id = 'e3083000-0000-4000-8000-000000000001' and platform = 'x'), '{}'::jsonb,
  'a post nobody asked to thread has no such setting');

-- 8. A Threads photo post takes 500 characters.
insert into storage.objects (bucket_id, name, owner)
select 'photos', 'e3080000-0000-4000-8000-00000000000a/' || (select id from t_draft limit 1) || '/1.jpg', 'e3080000-0000-4000-8000-00000000000a';
grant select on t_draft to authenticated;
set local role authenticated;
select lives_ok(format($$ select public.photo_post_save(%L, array[%L], %L, array['threads']) $$, (select id from t_draft limit 1),
  'e3080000-0000-4000-8000-00000000000a/' || (select id from t_draft limit 1) || '/1.jpg', rpad('', 600, 'A day at the desk. ')), 'a long caption is saved on the draft');
select throws_ok(format($$ select public.photo_post_schedule(%L) $$, (select id from t_draft limit 1)), '22023',
  'Threads takes up to 500 characters with photos. Shorten the caption, or leave Threads out.', 'and refused for Threads before it is scheduled');
select lives_ok(format($$ select public.photo_post_save(%L, array[%L], 'A day at the desk.', array['threads']) $$, (select id from t_draft limit 1),
  'e3080000-0000-4000-8000-00000000000a/' || (select id from t_draft limit 1) || '/1.jpg'), 'a short one is saved');
reset role;

select * from finish();
rollback;
