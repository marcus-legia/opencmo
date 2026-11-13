-- 20270121020000: photo drafts are cleaned up (F3). A save deletes the photos it drops, starting again deletes the
-- draft it empties, and the cleanup cron closes drafts untouched for 7 days. A photo a scheduled post lists is never
-- queued for deletion, and a draft the founder is working on is never swept.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(24);

select ok(not has_function_privilege('authenticated', 'public.photo_draft_release(uuid,text[])', 'execute'),
  'a founder cannot release photos');
select ok(not has_function_privilege('anon', 'public.photo_draft_release(uuid,text[])', 'execute'), 'nor can anon');
select ok(not has_function_privilege('authenticated', 'public.photo_drafts_sweep(integer)', 'execute'), 'a founder cannot sweep');
select ok(has_function_privilege('service_role', 'public.photo_drafts_sweep(integer)', 'execute'), 'the cleanup cron can');

insert into auth.users (id, email) values
  ('e3100000-0000-4000-8000-00000000000a', 'drafts-a@test.local'),
  ('e3100000-0000-4000-8000-00000000000b', 'drafts-b@test.local');
update public.profiles set plan = 'starter', timezone = 'UTC'
where id in ('e3100000-0000-4000-8000-00000000000a', 'e3100000-0000-4000-8000-00000000000b');
delete from public.storage_deletions where bucket = 'photos';

-- Founder A: a draft with three uploads, two of them saved.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3100000-0000-4000-8000-00000000000a","role":"authenticated"}';
create temp table t on commit drop as select public.photo_post_create() as id;
reset role;
grant select on t to authenticated;
insert into storage.objects (bucket_id, name, owner)
select 'photos', 'e3100000-0000-4000-8000-00000000000a/' || (select id from t) || '/' || i || '.jpg', 'e3100000-0000-4000-8000-00000000000a'
from generate_series(1, 3) i;
create function pg_temp.photo(i int) returns text language sql as $$
  select 'e3100000-0000-4000-8000-00000000000a/' || (select id from t) || '/' || i || '.jpg'
$$;
grant execute on function pg_temp.photo(int) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3100000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.photo_post_save((select id from t), array[pg_temp.photo(1), pg_temp.photo(2)], 'Two photos.', array['tiktok']);
reset role;
select is((select count(*)::int from public.storage_deletions where bucket = 'photos'), 0, 'a save that drops nothing deletes nothing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3100000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.photo_post_save((select id from t), array[pg_temp.photo(1)], 'One photo.', array['tiktok']);
reset role;
select is((select array_agg(path) from public.storage_deletions where bucket = 'photos'), array[pg_temp.photo(2)],
  'the photo dropped from the list is queued for deletion, the kept one is not');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3100000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.photo_post_save(%L, %L, 'Back again.', array['tiktok']) $$,
  (select id from t), array[pg_temp.photo(1), pg_temp.photo(2)]), '22023', 'A photo is missing. Upload it again.',
  'a photo queued for deletion cannot be put back');

-- Starting again empties the draft: every object of its folder goes, the unsaved upload too.
select is(public.photo_post_create(), (select id from t), 'starting again reuses the draft');
reset role;
select is((select count(*)::int from public.storage_deletions where bucket = 'photos'
  and path like 'e3100000-0000-4000-8000-00000000000a/' || (select id from t) || '/%'), 3, 'all three of its photos are queued');
select is((select count(*)::int from public.storage_deletions where bucket = 'photos'), 3, 'each once');

-- A photo a scheduled post lists is never released, whichever folder it is in.
insert into public.photo_posts (id, user_id, photos, caption, platforms, status, updated_at) values
  ('e3101000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-00000000000a',
   array['e3100000-0000-4000-8000-00000000000a/e3101000-0000-4000-8000-000000000002/kept.jpg'], 'Scheduled.', array['tiktok'],
   'scheduled', now() - interval '30 days'),
  ('e3101000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-00000000000a', '{}', '', '{}', 'cancelled', now()),
  -- Founder B: an abandoned draft, one being worked on (an upload this week), and a fresh one.
  ('e3101000-0000-4000-8000-000000000003', 'e3100000-0000-4000-8000-00000000000b', '{}', '', '{}', 'draft', now() - interval '8 days'),
  ('e3101000-0000-4000-8000-000000000004', 'e3100000-0000-4000-8000-00000000000b', '{}', '', '{}', 'draft', now() - interval '8 days'),
  ('e3101000-0000-4000-8000-000000000005', 'e3100000-0000-4000-8000-00000000000b', '{}', '', '{}', 'draft', now() - interval '1 day');
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('photos', 'e3100000-0000-4000-8000-00000000000a/e3101000-0000-4000-8000-000000000002/kept.jpg', 'e3100000-0000-4000-8000-00000000000a', now() - interval '30 days'),
  ('photos', 'e3100000-0000-4000-8000-00000000000b/e3101000-0000-4000-8000-000000000003/old.jpg', 'e3100000-0000-4000-8000-00000000000b', now() - interval '8 days'),
  ('photos', 'e3100000-0000-4000-8000-00000000000b/e3101000-0000-4000-8000-000000000004/old.jpg', 'e3100000-0000-4000-8000-00000000000b', now() - interval '8 days'),
  ('photos', 'e3100000-0000-4000-8000-00000000000b/e3101000-0000-4000-8000-000000000004/new.jpg', 'e3100000-0000-4000-8000-00000000000b', now() - interval '2 days'),
  ('photos', 'e3100000-0000-4000-8000-00000000000b/e3101000-0000-4000-8000-000000000005/a.jpg', 'e3100000-0000-4000-8000-00000000000b', now() - interval '1 day');
update public.photo_posts set status = 'draft' where id = 'e3101000-0000-4000-8000-000000000002';
select is(public.photo_draft_release('e3101000-0000-4000-8000-000000000002'), 0, 'a draft''s object a scheduled post lists is not queued');
select is(public.photo_draft_release('e3101000-0000-4000-8000-000000000001'), 0, 'a scheduled post is not a draft to release');

-- Review focus 4: the sweep.
select throws_ok($$ select public.photo_drafts_sweep(0) $$, '22023', null, 'a sweep of zero days is refused');
set local role service_role;
select is(public.photo_drafts_sweep(7), 1, 'the cron closes the one draft untouched for 7 days');
reset role;
select is((select status from public.photo_posts where id = 'e3101000-0000-4000-8000-000000000003'), 'cancelled', 'the abandoned draft is closed');
select is((select count(*)::int from public.storage_deletions
  where path = 'e3100000-0000-4000-8000-00000000000b/e3101000-0000-4000-8000-000000000003/old.jpg'), 1, 'and its photo queued');
select is((select array_agg(status order by id) from public.photo_posts
  where id in ('e3101000-0000-4000-8000-000000000004', 'e3101000-0000-4000-8000-000000000005')), array['draft', 'draft'],
  'a draft with an upload this week, or saved this week, is kept');
select is((select count(*)::int from public.storage_deletions
  where path like '%kept.jpg' or path like '%/e3101000-0000-4000-8000-000000000004/%' or path like '%/e3101000-0000-4000-8000-000000000005/%'),
  0, 'none of their photos, nor a scheduled post''s, is queued');
create temp table before_rerun on commit drop as select count(*)::int as n from public.storage_deletions;
set local role service_role;
select is(public.photo_drafts_sweep(7), 0, 'a second sweep closes nothing');
reset role;
select is((select count(*)::int from public.storage_deletions), (select n from before_rerun), 'and queues nothing twice');

-- A closed draft says so, and its photos go too (drafts closed before 20270121020000 are released by the migration).
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3100000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.photo_post_save('e3101000-0000-4000-8000-000000000003', '{}', '', '{}') $$,
  'P0001', 'This draft was closed. Start a new photo post.', 'saving a closed draft says it was closed');
select throws_ok($$ select public.photo_post_schedule('e3101000-0000-4000-8000-000000000003') $$,
  'P0001', 'This draft was closed. Start a new photo post.', 'so does scheduling it');
reset role;
insert into public.photo_posts (id, user_id, status) values
  ('e3101000-0000-4000-8000-000000000006', 'e3100000-0000-4000-8000-00000000000b', 'cancelled');
insert into storage.objects (bucket_id, name, owner) values
  ('photos', 'e3100000-0000-4000-8000-00000000000b/e3101000-0000-4000-8000-000000000006/left.jpg', 'e3100000-0000-4000-8000-00000000000b');
select is(public.photo_draft_release('e3101000-0000-4000-8000-000000000006'), 1, 'a draft closed earlier still releases its photo');
select is(public.photo_draft_release('e3101000-0000-4000-8000-000000000006'), 0, 'once');

select * from finish();
rollback;
