-- Explainers (20261124090000): the motion-explainer model takes only explainer scenes with the
-- caller's own code_ref, a valid script and a listed voice; the price follows duration and
-- narration length.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

-- The bookkeeping RPCs are service-role only since 20261210201000; these cases test what they do,
-- so this transaction lends them to authenticated (rolled back below).
grant execute on function public.agent_record_usage_for(uuid, uuid, text, integer, integer, integer, integer),
  public.agent_append_for(uuid, uuid, text, jsonb),
  public.agent_record_tool_for(uuid, uuid, text, text, jsonb, text, jsonb, jsonb),
  public.agent_finish_turn_for(uuid, uuid, text, text) to authenticated;

select no_plan();

insert into auth.users (id, email) values
  ('e1540000-0000-4000-8000-00000000000a', 'explainer-a@test.local'),
  ('e1540000-0000-4000-8000-00000000000b', 'explainer-b@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1541000-0000-4000-8000-00000000000a', 'e1540000-0000-4000-8000-00000000000a', 'https://a', 600, 'done'),
  ('e1541000-0000-4000-8000-00000000000b', 'e1540000-0000-4000-8000-00000000000b', 'https://b', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1540000-0000-4000-8000-00000000000a', 100, 'test grant'),
  ('e1540000-0000-4000-8000-00000000000b', 100, 'test grant');

create temp table t_spec (name text primary key, spec jsonb) on commit drop;
grant all on t_spec to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1540000-0000-4000-8000-00000000000a"}';

insert into t_spec values ('ok', jsonb_build_object(
  'prompt', 'Explainer: How Shazam hears a song', 'aspectRatio', '16:9', 'duration', 20, 'voice', 'Aria',
  'scene', jsonb_build_object(
    'template', 'explainer',
    'code_ref', public.save_scene_code('return function Scene() { return null; };'),
    'title', 'How Shazam hears a song',
    'accent', '#12abEF',
    'beats', jsonb_build_array(
      jsonb_build_object('say', 'A noisy bar.', 'label', 'Noisy bar'),
      jsonb_build_object('say', 'Peaks become a map.'),
      jsonb_build_object('say', 'Pairs become fingerprints.', 'label', 'f1 | f2 | gap')))));

create function pg_temp.spec_with(p_path text[], p_value jsonb) returns jsonb language sql as $$
  select jsonb_set((select spec from t_spec where name = 'ok'), p_path, p_value)
$$;
create function pg_temp.spec_without(p_key text) returns jsonb language sql as $$
  select (select spec from t_spec where name = 'ok') - p_key
$$;
create function pg_temp.create_with(p_spec jsonb) returns jsonb language sql as $$
  select public.create_generation('e1541000-0000-4000-8000-00000000000a', null, 'motion-explainer',
    p_spec, encode(sha256(convert_to(p_spec::text, 'UTF8')), 'hex'), gen_random_uuid())
$$;

-- The price: 1 credit per started 10 s + 5 per started 1,000 narration characters.
select is(public.ai_price((select m from public.ai_models m where id = 'motion-explainer'),
  (select spec from t_spec where name = 'ok')), 2 + 5, '20 s, short narration: 2 + 5');
select is(public.ai_price((select m from public.ai_models m where id = 'motion-explainer'),
  pg_temp.spec_with('{duration}', '25')), 3 + 5, '25 s: 3 + 5');
select is(public.ai_price((select m from public.ai_models m where id = 'motion-explainer'),
  pg_temp.spec_with('{scene,beats}', (select jsonb_agg(jsonb_build_object('say', '  ' || repeat('y', 200) || ' ')) from generate_series(1, 6)))),
  2 + 10, 'narration of 6×200 characters + 5 spaces = 1205: two voice units');

select is(
  (pg_temp.create_with((select spec from t_spec where name = 'ok'))->'generation'->>'credits_reserved')::int,
  7, 'a valid explainer is created and holds its price'
);
select is((select kind from public.generations where model = 'motion-explainer'), 'video', 'it is a video');

select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{voice}', '"Someone Real"')) $$,
  '22023', 'Choose one of the listed voices.', 'unlisted voice');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_without('voice')) $$,
  '22023', 'Choose one of the listed voices.', 'missing voice');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{duration}', '12')) $$,
  '22023', 'Explainer does not support that duration.', 'duration off the 5 s grid');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,template}', '"code"')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'the explainer model takes only explainer scenes');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,code_ref}', to_jsonb(repeat('e', 64)))) $$,
  '22023', 'This explainer code was not found. Preview it again.', 'unknown code_ref');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,beats}', '[{"say":"One."},{"say":"Two."}]')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'fewer than 3 beats');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,beats,1}', '{"say":"   "}')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'empty narration');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,beats,1}', '{"say":"ok","colour":"red"}')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'unknown beat field');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,beats,1}', jsonb_build_object('say', 'ok', 'label', repeat('w', 41)))) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'label over 40 characters');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,accent}', '"red"')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'accent is not a hex colour');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,beats}', (select jsonb_agg(jsonb_build_object('say', repeat('x', 240))) from generate_series(1, 16)))) $$,
  '22023', 'This 3D scene has too much data.', 'the scene stays under 4000 bytes');

-- The 3D model does not take explainer scenes or a voice.
select throws_ok($$ select public.create_generation('e1541000-0000-4000-8000-00000000000a', null, 'studio-3d',
    jsonb_set(pg_temp.spec_without('voice'), '{duration}', '5') || '{"aspectRatio":"9:16"}', repeat('a', 64), gen_random_uuid()) $$,
  '22023', 'Describe the 3D scene first.', '3D Studio refuses an explainer scene');
select throws_ok($$ select public.create_generation('e1541000-0000-4000-8000-00000000000a', null, 'studio-3d',
    jsonb_set((select spec from t_spec where name = 'ok'), '{duration}', '5') || '{"aspectRatio":"9:16"}', repeat('b', 64), gen_random_uuid()) $$,
  '22023', 'This request has settings the model does not take.', '3D Studio takes no voice');

-- An explainer turn that previewed its scene gets the bigger hold, like a 3D turn.
reset role;
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e1542000-0000-4000-8000-00000000000a', 'e1541000-0000-4000-8000-00000000000a', 0, 1, 20, 1, 20);
set local role authenticated;
create temporary table s as select * from public.agent_open_session('e1542000-0000-4000-8000-00000000000a', 'fake');
create temporary table t1 as select * from public.agent_begin_turn((select id from s), '/explain Shazam', '[{"text":"x"}]');
select is(public.agent_raise_hold_3d((select id from t1)), (select hold_credits from t1), 'no preview yet: the hold stays');
select lives_ok(
  $$ select public.agent_record_tool_for(auth.uid(), (select id from t1), 'p_0', 'preview_explainer', '{"code":"return () => null;"}', 'done',
       '{"summary":"Previewed the explainer"}', null) $$,
  'record a preview_explainer call'
);
select is(public.agent_raise_hold_3d((select id from t1)), public.agent_3d_hold_credits(), 'after preview_explainer: the 3D hold');

-- User B cannot render A's code by its hash.
set local request.jwt.claims = '{"sub":"e1540000-0000-4000-8000-00000000000b"}';
select throws_ok($$ select public.create_generation('e1541000-0000-4000-8000-00000000000b', null, 'motion-explainer',
    (select spec from t_spec where name = 'ok'), repeat('c', 64), gen_random_uuid()) $$,
  '22023', 'This explainer code was not found. Preview it again.', 'another user''s code_ref is refused');

select * from finish();
rollback;
