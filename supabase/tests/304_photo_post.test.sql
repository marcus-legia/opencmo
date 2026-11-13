-- 20270120060000: a photo post is the founder's own photos. TikTok takes up to 35, Instagram and Threads up to 20; each
-- picked platform gets one slot from its connected account; photos upload only with a reservation under the post.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(16);

select ok(not has_function_privilege('authenticated', 'public.cmo_save_photo_caption(uuid,uuid,uuid,text)', 'execute'), 'only the runner saves a caption');
select ok(has_function_privilege('authenticated', 'public.photo_post_schedule(uuid)', 'execute'), 'the founder schedules it');

insert into auth.users (id, email) values
  ('e3040000-0000-4000-8000-00000000000a', 'photos-a@test.local'),
  ('e3040000-0000-4000-8000-00000000000b', 'photos-b@test.local');
update public.profiles set plan = 'starter', credit_balance = 20, timezone = 'UTC'
where id in ('e3040000-0000-4000-8000-00000000000a', 'e3040000-0000-4000-8000-00000000000b');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3040000-0000-4000-8000-00000000000a","role":"authenticated"}';
create temp table t on commit drop as select public.photo_post_create() as id;
reset role;
grant select on t to authenticated;

-- 36 uploaded photos under the post's folder, as TUS would leave them.
insert into storage.objects (bucket_id, name, owner)
select 'photos', 'e3040000-0000-4000-8000-00000000000a/' || (select id from t) || '/' || i || '.jpg', 'e3040000-0000-4000-8000-00000000000a'
from generate_series(1, 36) i;
create function pg_temp.photos(n int) returns text[] language sql as $$
  select array(select 'e3040000-0000-4000-8000-00000000000a/' || (select id from t) || '/' || i || '.jpg' from generate_series(1, n) i order by i)
$$;
grant execute on function pg_temp.photos(int) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3040000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.photo_post_save(%L, %L, 'A caption', array['tiktok']) $$, (select id from t), pg_temp.photos(36)),
  '22023', 'TikTok takes up to 35 photos.', '36 photos to TikTok is refused');
select throws_ok(format($$ select public.photo_post_save(%L, %L, 'A caption', array['instagram']) $$, (select id from t), pg_temp.photos(21)),
  '22023', 'Instagram takes up to 20 photos.', '21 to Instagram is refused');
select throws_ok(format($$ select public.photo_post_save(%L, %L, 'A caption', array['threads']) $$, (select id from t), pg_temp.photos(21)),
  '22023', 'Threads takes up to 20 photos.', '21 to Threads is refused');
select throws_ok(format($$ select public.photo_post_save(%L, array['e3040000-0000-4000-8000-00000000000b/x/1.jpg'], '', array['tiktok']) $$, (select id from t)),
  '22023', 'A photo is missing. Upload it again.', 'a photo outside the post''s folder is refused');
select lives_ok(format($$ select public.photo_post_save(%L, %L, 'Three cuts from the demo day. #buildinpublic', array['tiktok', 'instagram']) $$,
  (select id from t), pg_temp.photos(3)), 'three photos to TikTok and Instagram are saved');
select throws_ok(format($$ select public.photo_post_schedule(%L) $$, (select id from t)), 'P0001', null,
  'without connected accounts it is refused');

-- Reservations: a photo under the founder's draft, an image type, 10 MB at most.
select lives_ok(format($$ select public.reserve_upload('photos', %L, 2000000, 'image/jpeg', %L) $$,
  'e3040000-0000-4000-8000-00000000000a/' || (select id from t) || '/new.jpg', (select id from t)), 'a photo upload is reserved');
select throws_ok(format($$ select public.reserve_upload('photos', %L, 2000000, 'video/mp4', %L) $$,
  'e3040000-0000-4000-8000-00000000000a/' || (select id from t) || '/new.mp4', (select id from t)), '22023', null, 'a video is not a photo');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3040000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok(format($$ select public.reserve_upload('photos', %L, 2000000, 'image/jpeg', %L) $$,
  'e3040000-0000-4000-8000-00000000000b/' || (select id from t) || '/new.jpg', (select id from t)), 'P0002', 'Photo post not found.',
  'nobody uploads into another founder''s post');
select throws_ok(format($$ select public.photo_post_save(%L, '{}', '', '{}') $$, (select id from t)), 'P0002', 'Photo post not found.',
  'nor saves it');
reset role;

select public.zernio_profile_save('e3040000-0000-4000-8000-00000000000a', 'prof-photos');
select public.social_account_save('e3040000-0000-4000-8000-00000000000a', 'tiktok', '@founder', null, 'acc-photos-tt');
select public.social_account_save('e3040000-0000-4000-8000-00000000000a', 'instagram', '@founder', null, 'acc-photos-ig');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3040000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is(public.photo_post_schedule((select id from t)), 2, 'a valid set makes one slot per platform');
reset role;

select is((select string_agg(s.platform || ' ' || s.mode, ', ' order by s.platform) from public.schedule_slots s
  join public.deliverables d on d.id = s.deliverable_id where d.ref_id = (select id from t)),
  'instagram publish, tiktok publish', 'each from its connected account');
select is((select jsonb_array_length(a.snapshot->'photos') from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  join public.deliverables d on d.id = s.deliverable_id where d.ref_id = (select id from t) and s.platform = 'instagram'), 3,
  'the schedule card carries the photos in order');
select is((select status from public.photo_posts where id = (select id from t)), 'scheduled', 'the post is scheduled');

select * from finish();
rollback;
