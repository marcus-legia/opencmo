-- Wave 4b A3 (20270203020000) and the review of #242 (20270203015000): what the deleted features left in SQL is gone
-- or refuses in plain words; photo posts live on only in `legacy_photo_posts`, which no founder reads and whose photos
-- the sweep keeps; quote cards have their own rate-limit bucket.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(16);

-- Nothing new for the removed jobs.
select is(public.cmo_job_daily_limit('write_video_brief'), 0, 'no video brief is queued');
select is(public.cmo_job_daily_limit('niche_video_research'), 0, 'no niche research is queued');
select is(public.cmo_job_daily_limit('photo_caption'), 0, 'no photo caption is queued');
select is(public.cmo_job_daily_limit('post_draft'), 10, 'the jobs that stay keep their limit');

-- TikTok and Instagram are no longer profiles.
select is(public.caption_profiles(), array['youtube'], 'captions are YouTube''s only');
select is(public.platform_profile('tiktok_caption'), null, 'no TikTok caption profile');
select is(public.platform_profile_id('Instagram'), null, 'Instagram maps to no profile');
select throws_ok($$ select public.caption_check('tiktok_caption', 'Cut by words', null) $$, '22023', 'Captions are for YouTube.',
  'a caption for a removed platform is refused in words');

-- The functions of the deleted features are gone.
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  and p.proname in ('photo_post_create', 'photo_post_save', 'photo_post_caption', 'photo_post_schedule', 'photo_post_check',
    'photo_draft_release', 'photo_drafts_sweep', 'cmo_save_photo_caption', 'studio_slideshow_rendering', 'studio_slideshow_rerender',
    'studio_slideshow_settle', 'studio_slideshow_fresh', 'content_items_post_image', 'create_post_image_edit',
    'studio_post_image_rendering', 'studio_post_image_settle', 'request_stills_export', 'cmo_drop_write_slides',
    'cmo_order_script', 'cmo_script_open')), 'no function of the deleted features is left');
select hasnt_table('public', 'photo_posts', 'the photo posts table is gone');

-- The legacy table: RLS on, no right for any founder.
select ok((select relrowsecurity from pg_class where oid = 'public.legacy_photo_posts'::regclass), 'legacy photo posts have RLS');
select ok(not has_table_privilege('authenticated', 'public.legacy_photo_posts', 'select'), 'no founder reads them');

-- A photo is a text post's only: no WebP, nothing under something that is not a post.
insert into auth.users (id, email) values ('e3510000-0000-4000-8000-00000000000a', 'drop-a@test.local');
create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
select pg_temp.as_user('e3510000-0000-4000-8000-00000000000a');
set local role authenticated;
select throws_ok($$ select public.reserve_upload('photos', 'e3510000-0000-4000-8000-00000000000a/e3510000-0000-4000-8000-0000000000d1/x.jpg',
  1000, 'image/jpeg', 'e3510000-0000-4000-8000-0000000000d1') $$, 'P0002', 'Post not found.', 'a photo needs a post of the founder''s');
select ok(public.rate_limit_hit('quote-cards', 300, 3600), 'quote cards have their own bucket');
reset role;

-- The sweep keeps the photos of a deleted photo post, for support.
insert into public.legacy_photo_posts (id, user_id, photos, caption, platforms, status, created_at, updated_at)
values (gen_random_uuid(), 'e3510000-0000-4000-8000-00000000000a',
  array['e3510000-0000-4000-8000-00000000000a/e3510000-0000-4000-8000-0000000000e1/1.jpg'], '', '{}', 'scheduled', now(), now());
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('photos', 'e3510000-0000-4000-8000-00000000000a/e3510000-0000-4000-8000-0000000000e1/1.jpg', 'e3510000-0000-4000-8000-00000000000a', now() - interval '30 days'),
  ('photos', 'e3510000-0000-4000-8000-00000000000a/e3510000-0000-4000-8000-0000000000e2/2.jpg', 'e3510000-0000-4000-8000-00000000000a', now() - interval '30 days');
select lives_ok($$ select public.post_photos_sweep(7) $$, 'the photo sweep runs');
select is((select array_agg(path order by path) from public.storage_deletions where user_id = 'e3510000-0000-4000-8000-00000000000a'),
  array['e3510000-0000-4000-8000-00000000000a/e3510000-0000-4000-8000-0000000000e2/2.jpg'],
  'a photo nothing uses is swept; a deleted photo post''s is kept');

select * from finish();
rollback;
