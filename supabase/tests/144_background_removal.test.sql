-- 20261114090000: background removal may read the caller's own clip video; upscale may not.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

insert into auth.users (id, email) values
  ('e1440000-0000-4000-8000-00000000000a', 'cutout-a@test.local'),
  ('e1440000-0000-4000-8000-00000000000b', 'cutout-b@test.local');
insert into storage.objects (bucket_id, name) values
  ('renders', 'e1440000-0000-4000-8000-00000000000a/clip/master/1.mp4'),
  ('renders', 'e1440000-0000-4000-8000-00000000000b/clip/master/1.mp4'),
  ('sources', 'e1440000-0000-4000-8000-00000000000a/job/proxy/1/clip.mp4');

select is(public.ai_price((select m from public.ai_models m where id = 'fal-veed-cutout'),
  '{"prompt":"Remove background","aspectRatio":"9:16","duration":6}'), 6, '1 credit per second');

set local request.jwt.claims = '{"sub":"e1440000-0000-4000-8000-00000000000a"}';
create temporary table cutout as select m from public.ai_models m where id = 'fake-cutout';
create temporary table upscaler as select m from public.ai_models m where id = 'fake-upscale';

select lives_ok(
  $$ select public.ai_check_spec((select m from cutout), '{"prompt":"Remove background","aspectRatio":"9:16","duration":5,"sourceVideo":"renders:e1440000-0000-4000-8000-00000000000a/clip/master/1.mp4","sourceStart":2}') $$,
  'own master'
);
select lives_ok(
  $$ select public.ai_check_spec((select m from cutout), '{"prompt":"Remove background","aspectRatio":"9:16","duration":5,"sourceVideo":"sources:e1440000-0000-4000-8000-00000000000a/job/proxy/1/clip.mp4","sourceStart":0}') $$,
  'own proxy'
);
select throws_ok(
  $$ select public.ai_check_spec((select m from cutout), '{"prompt":"Remove background","aspectRatio":"9:16","duration":5,"sourceVideo":"renders:e1440000-0000-4000-8000-00000000000b/clip/master/1.mp4","sourceStart":0}') $$,
  '22023', 'Choose a video from your library to edit.', 'someone else''s master'
);
select throws_ok(
  $$ select public.ai_check_spec((select m from cutout), '{"prompt":"Remove background","aspectRatio":"9:16","duration":5,"sourceVideo":"media:e1440000-0000-4000-8000-00000000000a/clip/master/1.mp4","sourceStart":0}') $$,
  '22023', 'Choose a video from your library to edit.', 'only renders and sources'
);
select throws_ok(
  $$ select public.ai_check_spec((select m from cutout), '{"prompt":"Remove background","aspectRatio":"9:16","duration":5,"sourceVideo":"renders:e1440000-0000-4000-8000-00000000000a/clip/master/missing.mp4","sourceStart":0}') $$,
  '22023', 'Choose a video from your library to edit.', 'the object must exist'
);
select throws_ok(
  $$ select public.ai_check_spec((select m from upscaler), '{"prompt":"Upscale","aspectRatio":"9:16","duration":5,"resolution":"1080p","sourceVideo":"renders:e1440000-0000-4000-8000-00000000000a/clip/master/1.mp4","sourceStart":0}') $$,
  '22023', 'Choose a video from your library to edit.', 'upscale still takes library files only'
);

select * from finish();
rollback;
