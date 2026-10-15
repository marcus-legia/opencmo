-- Explainer v2 (20261126090000): explainer scenes take an optional `theme` and `personality`
-- from fixed lists, the price ignores them, and `complete_generation` keeps the voice's word
-- timings for explainers (same checks as voiceovers) so the editor can add captions.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select no_plan();

insert into auth.users (id, email) values ('e1560000-0000-4000-8000-00000000000a', 'explainer-v2@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1561000-0000-4000-8000-00000000000a', 'e1560000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1560000-0000-4000-8000-00000000000a', 100, 'test grant');

create temp table t_spec (name text primary key, spec jsonb) on commit drop;
grant all on t_spec to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1560000-0000-4000-8000-00000000000a"}';

insert into t_spec values ('ok', jsonb_build_object(
  'prompt', 'Explainer: How a vaccine works', 'aspectRatio', '16:9', 'duration', 20, 'voice', 'Aria',
  'scene', jsonb_build_object(
    'template', 'explainer',
    'code_ref', public.save_scene_code('return function Scene() { return null; };'),
    'title', 'How a vaccine works',
    'theme', 'paper',
    'personality', 'playful',
    'beats', jsonb_build_array(
      jsonb_build_object('say', 'A virus gets in.', 'label', 'The virus'),
      jsonb_build_object('say', 'The vaccine shows a harmless piece.'),
      jsonb_build_object('say', 'Memory cells remember it.')))));

create function pg_temp.spec_with(p_path text[], p_value jsonb) returns jsonb language sql as $$
  select jsonb_set((select spec from t_spec where name = 'ok'), p_path, p_value)
$$;
create function pg_temp.create_with(p_spec jsonb) returns jsonb language sql as $$
  select public.create_generation('e1561000-0000-4000-8000-00000000000a', null, 'motion-explainer',
    p_spec, encode(sha256(convert_to(p_spec::text, 'UTF8')), 'hex'), gen_random_uuid())
$$;

-- ================================================================ theme and personality
select is(public.ai_price((select m from public.ai_models m where id = 'motion-explainer'),
  (select spec from t_spec where name = 'ok')), 2 + 5, 'theme and personality do not change the price');
select lives_ok($$ select pg_temp.create_with((select spec from t_spec where name = 'ok')) $$,
  'paper + playful is accepted');
select lives_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene}',
    ((select spec from t_spec where name = 'ok')->'scene') - 'theme' - 'personality')) $$,
  'a v1 scene without theme or personality is still accepted');
select lives_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,theme}', '"blueprint"')
    #- '{scene,personality}' || jsonb_build_object('duration', 25)) $$,
  'blueprint alone is accepted');
select lives_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,personality}', to_jsonb(p))) from
    unnest(array['premium', 'corporate', 'energetic']) p $$,
  'every listed personality is accepted');

select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,theme}', '"neon"')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'unknown theme');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,theme}', '["paper"]')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'theme that is not a string');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,theme}', 'null')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'theme set to null');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,personality}', '"Playful"')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'personality names are exact');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,personality}', '3')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'personality that is not a string');
select throws_ok($$ select pg_temp.create_with(pg_temp.spec_with('{scene,beats,0,visual}', '"a syringe"')) $$,
  '22023', 'This explainer script is not valid. Write it again.', 'the storyboard visual is not part of the spec');

-- ================================================================ word timings
-- One explainer and one image, each claimed and completed with words.
reset role;
update public.tasks set status = 'cancelled' where kind = 'generate' and status = 'queued';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1560000-0000-4000-8000-00000000000a"}';
create temporary table g1 as select pg_temp.create_with(pg_temp.spec_with('{duration}', '30')) as r;

reset role;
create temporary table c1 as select * from public.claim_next_task(array['generate'], 300);
select is((select payload->>'generation_id' from c1), (select r->'generation'->>'id' from g1), 'the worker claims the explainer');
select ok(
  public.complete_generation((select id from c1), (select attempt_id from c1),
    'e1560000-0000-4000-8000-00000000000a/e1561000-0000-4000-8000-00000000000a/gen-' || (select attempt_id from c1) || '.mp4',
    'explainer.mp4', 30, 1920, 1080, 7,
    '[{"text":"A","start":0,"end":0.2},{"text":"virus","start":0.2,"end":0.7},{"text":"gets","start":0.7,"end":1}]'),
  'complete the explainer with its words'
);
select is(
  (select words from public.media_assets
     where id = (select media_asset_id from public.generations where id = (select (r->'generation'->>'id')::uuid from g1))),
  '[{"text":"A","start":0,"end":0.2},{"text":"virus","start":0.2,"end":0.7},{"text":"gets","start":0.7,"end":1}]'::jsonb,
  'the explainer''s words are kept on its media asset'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1560000-0000-4000-8000-00000000000a"}';
create temporary table g2 as select pg_temp.create_with(pg_temp.spec_with('{duration}', '35')) as r;
reset role;
create temporary table c2 as select * from public.claim_next_task(array['generate'], 300);
select ok(
  public.complete_generation((select id from c2), (select attempt_id from c2),
    'e1560000-0000-4000-8000-00000000000a/e1561000-0000-4000-8000-00000000000a/gen-' || (select attempt_id from c2) || '.mp4',
    'explainer.mp4', 35, 1920, 1080, 7, '[{"text":"bad","start":2,"end":1}]'),
  'an explainer with malformed words still completes'
);
select ok(
  (select words is null from public.media_assets
     where id = (select media_asset_id from public.generations where id = (select (r->'generation'->>'id')::uuid from g2))),
  'malformed words are dropped, like a voiceover''s'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1560000-0000-4000-8000-00000000000a"}';
create temporary table g3 as select public.create_generation('e1561000-0000-4000-8000-00000000000a', null, 'fake-image',
  '{"prompt":"a cell","aspectRatio":"1:1"}', repeat('f', 64), gen_random_uuid()) as r;
reset role;
create temporary table c3 as select * from public.claim_next_task(array['generate'], 300);
select ok(
  public.complete_generation((select id from c3), (select attempt_id from c3),
    'e1560000-0000-4000-8000-00000000000a/e1561000-0000-4000-8000-00000000000a/gen-' || (select attempt_id from c3) || '.png',
    'a cell.png', null, 1024, 1024, 1, '[{"text":"x","start":0,"end":1}]'),
  'complete an image with words'
);
select ok(
  (select words is null from public.media_assets
     where id = (select media_asset_id from public.generations where id = (select (r->'generation'->>'id')::uuid from g3))),
  'other generations still drop words'
);

select * from finish();
rollback;
