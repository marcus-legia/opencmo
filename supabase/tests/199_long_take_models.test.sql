-- Long take, Task 1 (20261226090000): the two first-and-last-frame rows are seeded, priced per second without
-- audio, and take a keyframe at each end of a shot.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

insert into auth.users (id, email) values
  ('e1970000-0000-4000-8000-00000000000a', 'long-take@test.local'),
  ('e1970000-0000-4000-8000-00000000000b', 'long-take-other@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1971000-0000-4000-8000-00000000000a', 'e1970000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1970000-0000-4000-8000-00000000000a', 200, 'test grant');
insert into storage.objects (bucket_id, name, owner) values
  ('media', 'e1970000-0000-4000-8000-00000000000a/keyframes/01.png', 'e1970000-0000-4000-8000-00000000000a'),
  ('media', 'e1970000-0000-4000-8000-00000000000a/keyframes/02.png', 'e1970000-0000-4000-8000-00000000000a'),
  ('media', 'e1970000-0000-4000-8000-00000000000b/keyframes/01.png', 'e1970000-0000-4000-8000-00000000000b');

create function pg_temp.price(p_model text, p_spec jsonb) returns integer language sql as $$
  select public.ai_price((select m from public.ai_models m where id = p_model), p_spec)
$$;
create function pg_temp.shot(p_aspect text, p_seconds int) returns jsonb language sql as $$
  select jsonb_build_object('prompt', 'A desk at dawn, the camera drifts in', 'aspectRatio', p_aspect, 'duration', p_seconds,
    'startImage', 'e1970000-0000-4000-8000-00000000000a/keyframes/01.png',
    'endImage', 'e1970000-0000-4000-8000-00000000000a/keyframes/02.png')
$$;
create function pg_temp.create_with(p_model text, p_spec jsonb) returns jsonb language sql as $$
  select public.create_generation('e1971000-0000-4000-8000-00000000000a', null, p_model,
    p_spec, encode(sha256(convert_to(p_model || p_spec::text, 'UTF8')), 'hex'), gen_random_uuid())
$$;
create function pg_temp.balance() returns bigint language sql as $$
  select public.credit_balance('e1970000-0000-4000-8000-00000000000a')
$$;

select is((select array_agg(name order by id) from public.ai_models where id in ('fal-veo', 'fal-kling-v3')),
  array['Cinematic square', 'Cinematic'], 'both rows are seeded, named for their quality, not the model');
select ok((select bool_and((limits->>'lastFrame')::boolean and (limits->>'silent')::boolean) from public.ai_models
  where id in ('fal-veo', 'fal-kling-v3')), 'both take a last frame and never pay for model audio');

select is(pg_temp.price('fal-veo', pg_temp.shot('9:16', 4)), 16, 'a 4 s cinematic shot costs 16 credits');
select is(pg_temp.price('fal-veo', pg_temp.shot('9:16', 6)), 24, 'a 6 s one costs 24');
select is(pg_temp.price('fal-veo', pg_temp.shot('9:16', 8) || '{"resolution":"1080p"}'), 32, 'an 8 s one costs 32, at 1080p too');
select is(pg_temp.price('fal-kling-v3', pg_temp.shot('1:1', 5)), 15, 'a 5 s square shot costs 15 credits');
select is(pg_temp.price('fal-kling-v3', pg_temp.shot('1:1', 10)), 30, 'a 10 s one costs 30');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1970000-0000-4000-8000-00000000000a"}';

create temporary table before as select pg_temp.balance() as credits;
select lives_ok($$ select pg_temp.create_with('fal-veo', pg_temp.shot('9:16', 8)) $$,
  'a cinematic shot from one keyframe to the next creates a generation');
select is(pg_temp.balance(), (select credits from before) - 32, 'and holds its 32 credits');
select lives_ok($$ select pg_temp.create_with('fal-kling-v3', pg_temp.shot('1:1', 5)) $$,
  'a square shot takes both keyframes too');

select throws_ok($$ select pg_temp.create_with('fal-veo', pg_temp.shot('1:1', 8)) $$,
  '22023', 'Cinematic does not support that aspect ratio.', 'the default row refuses the square frame it cannot make');
select throws_ok($$ select pg_temp.create_with('fal-veo', pg_temp.shot('9:16', 5)) $$,
  '22023', 'Cinematic does not support that duration.', 'and a length it does not offer');
select throws_ok($$ select pg_temp.create_with('fal-veo', pg_temp.shot('9:16', 8) || '{"audio":true}') $$,
  '22023', 'This request has settings the model does not take.', 'model audio cannot be asked for');
select throws_ok($$ select pg_temp.create_with('fal-veo',
    jsonb_set(pg_temp.shot('9:16', 8), '{endImage}', '"e1970000-0000-4000-8000-00000000000b/keyframes/01.png"')) $$,
  '22023', 'That image was not found in your library.', 'another user''s keyframe cannot end a shot');

select * from finish();
rollback;
