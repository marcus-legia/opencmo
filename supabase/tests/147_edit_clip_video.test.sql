-- 20261117090000: edit models flagged `clipVideo` may read the caller's own clip video.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(8);

insert into auth.users (id, email) values
  ('e1470000-0000-4000-8000-00000000000a', 'edit-a@test.local'),
  ('e1470000-0000-4000-8000-00000000000b', 'edit-b@test.local');
insert into storage.objects (bucket_id, name) values
  ('renders', 'e1470000-0000-4000-8000-00000000000a/clip/master/1.mp4'),
  ('renders', 'e1470000-0000-4000-8000-00000000000b/clip/master/1.mp4'),
  ('sources', 'e1470000-0000-4000-8000-00000000000a/job/proxy/1/clip.mp4');

select is((select (limits->>'clipVideo')::boolean from public.ai_models where id = 'fal-kling-edit'), true, 'Kling edit reads clip video');
select is((select count(*)::int from public.ai_models where limits ? 'clipVideo'), 2, 'only the two edit models');

set local request.jwt.claims = '{"sub":"e1470000-0000-4000-8000-00000000000a"}';
create temporary table editor as select m from public.ai_models m where id = 'fake-edit';

select lives_ok(
  $$ select public.ai_check_spec((select m from editor), '{"prompt":"make it night","aspectRatio":"9:16","duration":5,"sourceVideo":"renders:e1470000-0000-4000-8000-00000000000a/clip/master/1.mp4","sourceStart":2}') $$,
  'own master'
);
select lives_ok(
  $$ select public.ai_check_spec((select m from editor), '{"prompt":"make it night","aspectRatio":"9:16","duration":5,"sourceVideo":"sources:e1470000-0000-4000-8000-00000000000a/job/proxy/1/clip.mp4","sourceStart":0}') $$,
  'own proxy'
);
select throws_ok(
  $$ select public.ai_check_spec((select m from editor), '{"prompt":"make it night","aspectRatio":"9:16","duration":5,"sourceVideo":"renders:e1470000-0000-4000-8000-00000000000b/clip/master/1.mp4","sourceStart":0}') $$,
  '22023', 'Choose a video from your library to edit.', 'someone else''s master'
);
select throws_ok(
  $$ select public.ai_check_spec((select m from editor), '{"prompt":"make it night","aspectRatio":"9:16","duration":5,"sourceVideo":"media:e1470000-0000-4000-8000-00000000000a/clip/master/1.mp4","sourceStart":0}') $$,
  '22023', 'Choose a video from your library to edit.', 'only renders and sources'
);
select throws_ok(
  $$ select public.ai_check_spec((select m from editor), '{"prompt":"make it night","aspectRatio":"9:16","duration":5,"sourceVideo":"renders:e1470000-0000-4000-8000-00000000000a/clip/master/missing.mp4","sourceStart":0}') $$,
  '22023', 'Choose a video from your library to edit.', 'the object must exist'
);
select throws_ok(
  $$ select public.ai_check_spec((select m from editor), '{"prompt":"make it night","aspectRatio":"9:16","duration":5,"sourceVideo":"renders:e1470000-0000-4000-8000-00000000000a/clip/../../e1470000-0000-4000-8000-00000000000b/clip/master/1.mp4","sourceStart":0}') $$,
  '22023', 'Choose a video from your library to edit.', 'no path traversal'
);

select * from finish();
rollback;
