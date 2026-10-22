-- Motion quality B1 (20261223100000): `motion-clip` is a silent 3-30 s motion piece. It takes a clip scene
-- with timed beats and no voice, costs 1 credit per started 10 s, and keeps the explainer's and A5's checks.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

insert into auth.users (id, email) values
  ('e1960000-0000-4000-8000-00000000000a', 'motion-clip@test.local'),
  ('e1960000-0000-4000-8000-00000000000b', 'motion-clip-other@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1961000-0000-4000-8000-00000000000a', 'e1960000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1960000-0000-4000-8000-00000000000a', 100, 'test grant');
insert into storage.objects (bucket_id, name, owner) values
  ('media', 'e1960000-0000-4000-8000-00000000000a/brand/logo.png', 'e1960000-0000-4000-8000-00000000000a'),
  ('media', 'e1960000-0000-4000-8000-00000000000b/brand/logo.png', 'e1960000-0000-4000-8000-00000000000b');

create temp table t_spec (name text primary key, spec jsonb) on commit drop;
grant all on t_spec to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1960000-0000-4000-8000-00000000000a"}';

insert into t_spec values ('ok', jsonb_build_object(
  'prompt', 'Motion clip: Logo reveal', 'aspectRatio', '16:9', 'duration', 5,
  'scene', jsonb_build_object(
    'template', 'clip',
    'code_ref', public.save_scene_code('return function Scene() { return null; };'),
    'title', 'Logo reveal',
    'beats', jsonb_build_array(
      jsonb_build_object('say', 'The mark lands.', 'seconds', 2),
      jsonb_build_object('say', 'The name rises.', 'label', 'OpenCMO', 'seconds', 3)))));

create function pg_temp.spec_with(p_path text[], p_value jsonb) returns jsonb language sql as $$
  select jsonb_set((select spec from t_spec where name = 'ok'), p_path, p_value)
$$;
create function pg_temp.create_with(p_model text, p_spec jsonb) returns jsonb language sql as $$
  select public.create_generation('e1961000-0000-4000-8000-00000000000a', null, p_model,
    p_spec, encode(sha256(convert_to(p_spec::text, 'UTF8')), 'hex'), gen_random_uuid())
$$;
create function pg_temp.balance() returns bigint language sql as $$
  select public.credit_balance('e1960000-0000-4000-8000-00000000000a')
$$;

select is((select price->>'unit' from public.ai_models where id = 'motion-clip'), 'explainer', 'the catalog row is seeded');
select is(public.ai_price((select m from public.ai_models m where id = 'motion-clip'), (select spec from t_spec where name = 'ok')), 1,
  'a 5 s clip costs 1 credit: no voice');
select is(public.ai_price((select m from public.ai_models m where id = 'motion-clip'), pg_temp.spec_with('{duration}', '25')), 3,
  'one credit per started 10 s');

create temporary table before as select pg_temp.balance() as credits;
grant select on before to authenticated;
select lives_ok($$ select pg_temp.create_with('motion-clip', (select spec from t_spec where name = 'ok')) $$,
  'a 5 s clip with 2 timed beats creates a generation');
select is(pg_temp.balance(), (select credits from before) - 1, 'and holds 1 credit');

select throws_ok($$ select pg_temp.create_with('motion-clip', (select spec from t_spec where name = 'ok') || '{"voice":"Aria"}') $$,
  '22023', 'This request has settings the model does not take.', 'a clip with a voice');
select throws_ok($$ select pg_temp.create_with('motion-clip', pg_temp.spec_with('{scene,beats}', jsonb_build_array(
    jsonb_build_object('say', 'One.', 'seconds', 16), jsonb_build_object('say', 'Two.', 'seconds', 15))) || '{"duration":30}') $$,
  '22023', 'This motion clip is longer than 30 seconds. Shorten its beats.', 'beats adding up to 31 s');
select throws_ok($$ select pg_temp.create_with('motion-clip', pg_temp.spec_with('{scene,beats}', jsonb_build_array(
    jsonb_build_object('say', 'One.', 'seconds', 4), jsonb_build_object('say', 'Two.', 'seconds', 3)))) $$,
  '22023', 'This motion clip is longer than 30 seconds. Shorten its beats.', 'beats longer than the paid duration');
select throws_ok($$ select pg_temp.create_with('motion-clip', pg_temp.spec_with('{scene,beats}', (select jsonb_agg(
    jsonb_build_object('say', 'Beat.', 'seconds', 0.5)) from generate_series(1, 9)))) $$,
  '22023', 'This motion clip is not valid. Write it again.', '9 beats');
select throws_ok($$ select pg_temp.create_with('motion-clip', pg_temp.spec_with('{scene,beats,0}', '{"say":"No time."}')) $$,
  '22023', 'This motion clip is not valid. Write it again.', 'a beat without seconds');
select throws_ok($$ select pg_temp.create_with('motion-clip', pg_temp.spec_with('{scene,template}', '"explainer"')) $$,
  '22023', 'This motion clip is not valid. Write it again.', 'an explainer scene on motion-clip');
select throws_ok($$ select pg_temp.create_with('motion-explainer', pg_temp.spec_with('{scene,beats}', jsonb_build_array(
    jsonb_build_object('say', 'One.'), jsonb_build_object('say', 'Two.'), jsonb_build_object('say', 'Three.')))
    || '{"voice":"Aria","duration":15}') $$,
  '22023', 'This explainer script is not valid. Write it again.', 'a clip scene on motion-explainer');
select throws_ok($$ select pg_temp.create_with('motion-clip', pg_temp.spec_with('{scene,assets}', jsonb_build_array(
    jsonb_build_object('name', 'logo', 'ref', 'e1960000-0000-4000-8000-00000000000b/brand/logo.png')))) $$,
  '22023', 'An image in this animation is not in your library. Pick it again.', 'A5''s image check holds for clips');
select lives_ok($$ select pg_temp.create_with('motion-clip', pg_temp.spec_with('{scene,assets}', jsonb_build_array(
    jsonb_build_object('name', 'logo', 'ref', 'e1960000-0000-4000-8000-00000000000a/brand/logo.png'))) || '{"seed":3}') $$,
  'and the user''s own logo is accepted');

select * from finish();
rollback;
