-- 20270121040000: photos on a text post (owner, 2026-11-13). Up to four of the founder's own photos, uploaded with a
-- reservation under the post, saved in order; part of the post card's snapshot and of each schedule card's hash; a
-- change after approval sends the schedule cards back; they replace the generated post image.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(18);

select ok(has_function_privilege('authenticated', 'public.post_photos_save(uuid,text[])', 'execute'), 'the founder saves a post''s photos');
select ok(not has_function_privilege('anon', 'public.post_photos_save(uuid,text[])', 'execute'), 'anon cannot');

insert into auth.users (id, email) values
  ('e3130000-0000-4000-8000-00000000000a', 'post-photos-a@test.local'),
  ('e3130000-0000-4000-8000-00000000000b', 'post-photos-b@test.local');
update public.profiles set plan = 'starter', credit_balance = 20, timezone = 'UTC'
where id in ('e3130000-0000-4000-8000-00000000000a', 'e3130000-0000-4000-8000-00000000000b');
select public.zernio_profile_save('e3130000-0000-4000-8000-00000000000a', 'prof-post-photos');
select public.social_account_save('e3130000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-post-photos-x');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3131000-0000-4000-8000-00000000000a', 'e3130000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'done');

-- A post in review with its card, one approved with its slot, one planned, one published.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body, wants_image) values
  ('e3132000-0000-4000-8000-000000000001', 'e3130000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 1, 'Review', 'in_review',
   '{"text":"A post in review.","targets":["x"]}', true),
  ('e3132000-0000-4000-8000-000000000002', 'e3130000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 2, 'Approved', 'approved',
   '{"text":"An approved post.","targets":["x"]}', false),
  ('e3132000-0000-4000-8000-000000000003', 'e3130000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 3, 'Planned', 'planned',
   '{}', false),
  ('e3132000-0000-4000-8000-000000000004', 'e3130000-0000-4000-8000-00000000000a', 'post', 'X', current_date - 1, 'Posted', 'published',
   '{"text":"Already out."}', false);
select public.approval_raise('e3130000-0000-4000-8000-00000000000a', 'content_item', 'e3132000-0000-4000-8000-000000000001');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3133000-0000-4000-8000-000000000002', 'e3130000-0000-4000-8000-00000000000a', 'e3131000-0000-4000-8000-00000000000a', 'post',
   'content_item', 'e3132000-0000-4000-8000-000000000002', 'decided');
update public.schedule_slots set status = 'waiting' where deliverable_id = 'e3133000-0000-4000-8000-000000000002';

insert into storage.objects (bucket_id, name, owner)
select 'photos', 'e3130000-0000-4000-8000-00000000000a/e3132000-0000-4000-8000-00000000000' || p || '/' || i || '.jpg',
  'e3130000-0000-4000-8000-00000000000a'
from generate_series(1, 2) p, generate_series(1, 5) i;
create function pg_temp.photos(p int, n int) returns text[] language sql as $$
  select array(select 'e3130000-0000-4000-8000-00000000000a/e3132000-0000-4000-8000-00000000000' || p || '/' || i || '.jpg'
               from generate_series(1, n) i order by i)
$$;
grant execute on function pg_temp.photos(int, int) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3130000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.reserve_upload('photos', 'e3130000-0000-4000-8000-00000000000a/e3132000-0000-4000-8000-000000000001/new.jpg',
  2000000, 'image/jpeg', 'e3132000-0000-4000-8000-000000000001') $$, 'a photo upload is reserved under a post in review');
select throws_ok($$ select public.reserve_upload('photos', 'e3130000-0000-4000-8000-00000000000a/e3132000-0000-4000-8000-000000000003/new.jpg',
  2000000, 'image/jpeg', 'e3132000-0000-4000-8000-000000000003') $$, 'P0002', 'Photo post not found.', 'not under a post not written yet');
select throws_ok(format($$ select public.post_photos_save('e3132000-0000-4000-8000-000000000001', %L) $$, pg_temp.photos(1, 5)),
  '22023', 'A post takes up to 4 photos.', 'five photos are refused');
select throws_ok(format($$ select public.post_photos_save('e3132000-0000-4000-8000-000000000001', %L) $$, pg_temp.photos(2, 1)),
  '22023', 'A photo is missing. Upload it again.', 'a photo of another post is refused');
select throws_ok($$ select public.post_photos_save('e3132000-0000-4000-8000-000000000004', '{}') $$,
  'P0001', 'This post is already posted; its photos cannot change.', 'a posted post keeps its photos');
select throws_ok($$ select public.post_photos_save('e3132000-0000-4000-8000-000000000003', '{}') $$,
  'P0001', 'Add photos once the post is written.', 'a planned post has none yet');

-- In review: the card is raised again with the photos in it.
select lives_ok(format($$ select public.post_photos_save('e3132000-0000-4000-8000-000000000001', %L) $$, pg_temp.photos(1, 2)),
  'two photos are saved on a post in review');
reset role;
select is((select jsonb_array_length(snapshot->'photos') from public.approvals
  where ref_kind = 'content_item' and ref_id = 'e3132000-0000-4000-8000-000000000001' and status = 'waiting'), 2,
  'the waiting post card carries the photos');
select is((select count(*)::int from public.approvals
  where ref_kind = 'content_item' and ref_id = 'e3132000-0000-4000-8000-000000000001' and status = 'waiting'), 1, 'one card, not two');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3130000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.post_photos_save('e3132000-0000-4000-8000-000000000001', pg_temp.photos(1, 1));
reset role;
select is((select array_agg(path) from public.storage_deletions where bucket = 'photos'), array[(pg_temp.photos(1, 2))[2]],
  'the photo dropped from the list is queued for deletion');

-- The founder's photos replace a generated image: approving the post orders none.
update public.content_items set status = 'approved' where id = 'e3132000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.work_orders where kind = 'build_post_image'
  and brief->>'postId' = 'e3132000-0000-4000-8000-000000000001'), 0, 'no post image is ordered for a post with photos');

-- Approved: the schedule card goes back to the founder with the photos in its hash.
create temp table before_hash on commit drop as
  select public.schedule_content('e3133000-0000-4000-8000-000000000002', 'x')->>'content_hash' as h;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3130000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok(format($$ select public.post_photos_save('e3132000-0000-4000-8000-000000000002', %L) $$, pg_temp.photos(2, 3)),
  'three photos are saved on an approved post');
reset role;
select is(public.schedule_content('e3133000-0000-4000-8000-000000000002', 'x')->'photos', to_jsonb(pg_temp.photos(2, 3)),
  'the slot posts the photos, in order');
select isnt(public.schedule_content('e3133000-0000-4000-8000-000000000002', 'x')->>'content_hash', (select h from before_hash),
  'and they are in its hash');
select is((select status from public.schedule_slots where deliverable_id = 'e3133000-0000-4000-8000-000000000002'), 'proposed',
  'the slot asks the founder again');

-- Another founder cannot touch the post.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3130000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.post_photos_save('e3132000-0000-4000-8000-000000000002', '{}') $$, 'P0002', 'Post not found.',
  'nobody saves photos on another founder''s post');
reset role;

select * from finish();
rollback;
