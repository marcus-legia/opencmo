-- Motion quality A5 (20261223100000): a motion scene's `assets` are at most 6 `{name, ref}`, each the
-- caller's own `media` object; anything else is refused before credits are held.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

insert into auth.users (id, email) values
  ('e1950000-0000-4000-8000-00000000000a', 'motion-assets@test.local'),
  ('e1950000-0000-4000-8000-00000000000b', 'motion-assets-other@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1951000-0000-4000-8000-00000000000a', 'e1950000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1950000-0000-4000-8000-00000000000a', 100, 'test grant');
insert into storage.objects (bucket_id, name, owner) values
  ('media', 'e1950000-0000-4000-8000-00000000000a/uploads/screen.png', 'e1950000-0000-4000-8000-00000000000a'),
  ('media', 'e1950000-0000-4000-8000-00000000000a/brand/logo.png', 'e1950000-0000-4000-8000-00000000000a'),
  ('media', 'e1950000-0000-4000-8000-00000000000b/uploads/theirs.png', 'e1950000-0000-4000-8000-00000000000b'),
  ('media', 'e1950000-0000-4000-8000-00000000000a/uploads/' || repeat('s', 400) || '.png', 'e1950000-0000-4000-8000-00000000000a');

create temp table t_spec (name text primary key, spec jsonb) on commit drop;
grant all on t_spec to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1950000-0000-4000-8000-00000000000a"}';

insert into t_spec values ('ok', jsonb_build_object(
  'prompt', 'Explainer: How OpenCMO makes clips', 'aspectRatio', '16:9', 'duration', 20, 'voice', 'Aria',
  'scene', jsonb_build_object(
    'template', 'explainer',
    'code_ref', public.save_scene_code('return function Scene() { return null; };'),
    'title', 'How OpenCMO makes clips',
    'beats', jsonb_build_array(
      jsonb_build_object('say', 'Upload one long video.'),
      jsonb_build_object('say', 'Cut it by its words.'),
      jsonb_build_object('say', 'Export a week of clips.')))));

create function pg_temp.with_assets(p_assets jsonb) returns jsonb language sql as $$
  select jsonb_set((select spec from t_spec where name = 'ok'), '{scene,assets}', p_assets)
$$;
create function pg_temp.create_with(p_spec jsonb) returns jsonb language sql as $$
  select public.create_generation('e1951000-0000-4000-8000-00000000000a', null, 'motion-explainer',
    p_spec, encode(sha256(convert_to(p_spec::text, 'UTF8')), 'hex'), gen_random_uuid())
$$;
create function pg_temp.asset(p_name text, p_ref text) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'ref', p_ref)
$$;

create function pg_temp.long_script() returns jsonb language sql as $$
  select jsonb_set(jsonb_set((select spec from t_spec where name = 'ok'), '{duration}', '90'), '{scene,beats}',
    (select jsonb_agg(jsonb_build_object('say', repeat('word ', 47) || 'end')) from generate_series(1, 14)))
$$;
create function pg_temp.long_assets() returns jsonb language sql as $$
  select jsonb_agg(pg_temp.asset('shot-' || i, 'e1950000-0000-4000-8000-00000000000a/uploads/' || repeat('s', 400) || '.png'))
  from generate_series(1, 6) i
$$;

select lives_ok($$ select pg_temp.create_with((select spec from t_spec where name = 'ok')) $$,
  'a scene without assets is still accepted');
select lives_ok($$ select pg_temp.create_with(pg_temp.with_assets(jsonb_build_array(
    pg_temp.asset('screen', 'e1950000-0000-4000-8000-00000000000a/uploads/screen.png'),
    pg_temp.asset('logo', 'e1950000-0000-4000-8000-00000000000a/brand/logo.png')))) $$,
  'the user''s own media objects are accepted');
select throws_ok($$ select pg_temp.create_with(pg_temp.with_assets(jsonb_build_array(
    pg_temp.asset('theirs', 'e1950000-0000-4000-8000-00000000000b/uploads/theirs.png')))) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', 'another user''s object');
select throws_ok($$ select pg_temp.create_with(pg_temp.with_assets(jsonb_build_array(
    pg_temp.asset('up', 'e1950000-0000-4000-8000-00000000000a/../e1950000-0000-4000-8000-00000000000b/uploads/theirs.png')))) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', 'a .. path');
select throws_ok($$ select pg_temp.create_with(pg_temp.with_assets((select jsonb_agg(
    pg_temp.asset('shot-' || i, 'e1950000-0000-4000-8000-00000000000a/uploads/screen.png')) from generate_series(1, 7) i))) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', '7 assets');
select throws_ok($$ select pg_temp.create_with(pg_temp.with_assets(jsonb_build_array(jsonb_build_object('name', 'screen')))) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', 'a missing ref');
select throws_ok($$ select pg_temp.create_with(pg_temp.with_assets(jsonb_build_array(
    pg_temp.asset('screen', 'e1950000-0000-4000-8000-00000000000a/uploads/missing.png')))) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', 'an object that does not exist');
select throws_ok($$ select pg_temp.create_with(pg_temp.with_assets(jsonb_build_array(
    pg_temp.asset('screen', 'e1950000-0000-4000-8000-00000000000a/uploads/screen.png'),
    pg_temp.asset('screen', 'e1950000-0000-4000-8000-00000000000a/brand/logo.png')))) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', 'two images with one name');
select throws_ok($$ select pg_temp.create_with(pg_temp.with_assets(jsonb_build_array(
    pg_temp.asset('Screen', 'e1950000-0000-4000-8000-00000000000a/uploads/screen.png')))) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', 'a name outside the pattern');
select throws_ok($$ select pg_temp.create_with(pg_temp.with_assets(jsonb_build_array(
    pg_temp.asset('screen', 'e1950000-0000-4000-8000-00000000000a/uploads/screen.png') || '{"src":"https://x"}'))) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', 'an extra key (a URL) is refused');
select throws_ok($$ select pg_temp.create_with(pg_temp.with_assets('{"screen":"x"}')) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', 'assets that are not a list');
-- A script just under the 4000-byte cap: 6 long image refs on top of it do not count against it.
select ok(octet_length((jsonb_set(pg_temp.long_script(), '{scene,assets}', pg_temp.long_assets())->'scene')::text) > 4000
  and octet_length((pg_temp.long_script()->'scene')::text) <= 4000, 'the fixture: script under the cap, script + images over it');
select lives_ok($$ select pg_temp.create_with(jsonb_set(pg_temp.long_script(), '{scene,assets}', pg_temp.long_assets())) $$,
  'images never count toward the script cap');
select throws_ok($$ select public.ai_motion_assets_ok('[]') $$,
  '42501', null, 'users cannot call the helper directly');

select * from finish();
rollback;
