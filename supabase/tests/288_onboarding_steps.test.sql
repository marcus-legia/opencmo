-- 3.2 (20270114030000): onboarding steps on the founder's own run; the three optional answers are checked, kept on the
-- profile and applied to the documents the CMO reads (once, idempotently); another founder's run is untouched.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(18);

insert into auth.users (id, email) values
  ('e2880000-0000-4000-8000-00000000000a', 'os-a@test.local'),
  ('e2880000-0000-4000-8000-00000000000b', 'os-b@test.local');
insert into public.cmo_runs (id, user_id, kind, status, input) values
  ('e2881000-0000-4000-8000-00000000000a', 'e2880000-0000-4000-8000-00000000000a', 'onboard', 'running', '{}'),
  ('e2881000-0000-4000-8000-00000000000b', 'e2880000-0000-4000-8000-00000000000b', 'onboard', 'running', '{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2880000-0000-4000-8000-00000000000a","role":"authenticated"}';

-- Steps.
select is(public.cmo_onboard_step('e2881000-0000-4000-8000-00000000000a', '[{"id":"site","status":"done"},{"id":"product","status":"running"}]'),
  true, 'the founder writes steps on their own run');
select is(public.cmo_onboard_step('e2881000-0000-4000-8000-00000000000b', '[{"id":"site","status":"done"}]'),
  false, 'not on another founder''s run');
select throws_ok($$ select public.cmo_onboard_step('e2881000-0000-4000-8000-00000000000a', '[{"id":"site","status":"done","label":"<b>x</b>"}]') $$,
  '22023', 'These steps are not valid.', 'only ids and states');
select throws_ok($$ select public.cmo_onboard_step('e2881000-0000-4000-8000-00000000000a', '[{"id":"Site!","status":"done"}]') $$,
  '22023', 'These steps are not valid.', 'ids are short lowercase words');
reset role;
select is((select steps from public.cmo_runs where id = 'e2881000-0000-4000-8000-00000000000a'),
  '[{"id":"site","status":"done"},{"id":"product","status":"running"}]'::jsonb, 'the steps are on the run');
select is((select steps from public.cmo_runs where id = 'e2881000-0000-4000-8000-00000000000b'), '[]'::jsonb, 'the other run is untouched');

-- Answers before the documents exist: kept on the profile.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2880000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.cmo_onboarding_answers('{"x_handle":"@paylane_hq","platforms":["linkedin","x"],"heard_from":"other","heard_from_note":"A podcast"}') $$,
  'answers are saved');
select throws_ok($$ select public.cmo_onboarding_answers('{"x_handle":"not a handle!"}') $$, '22023',
  'An X handle has 1 to 15 letters, numbers or underscores.', 'a bad handle is refused');
select throws_ok($$ select public.cmo_onboarding_answers('{"platforms":["tiktok"]}') $$, '22023', 'Pick X, Threads or LinkedIn.', 'an unknown platform is refused');
select throws_ok($$ select public.cmo_onboarding_answers('{"plan":"starter"}') $$, '22023', 'These answers are not valid.', 'an unknown key is refused');
select throws_ok($$ select public.cmo_onboarding_answers('{"heard_from":"tv"}') $$, '22023', 'These answers are not valid.', 'heard_from from the list only');
reset role;
select is((select x_handle || ' ' || array_to_string(post_platforms, ',') || ' ' || heard_from || ' ' || heard_from_note
  from public.profiles where id = 'e2880000-0000-4000-8000-00000000000a'), 'paylane_hq linkedin,x other A podcast', 'kept on the profile');

-- The documents arrive; `{}` applies what was saved.
insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e2880000-0000-4000-8000-00000000000a', 'product', 1, '{"name":"Paylane","x_handle":""}', 'agent'),
  ('e2880000-0000-4000-8000-00000000000a', 'content_strategy', 1, '{"cadence":"Three posts a week."}', 'agent');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2880000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.cmo_onboarding_answers('{}') $$, 'onboarding applies the saved answers');
reset role;
select is((select body->>'x_handle' from public.marketing_documents_latest where user_id = 'e2880000-0000-4000-8000-00000000000a' and kind = 'product'),
  '@paylane_hq', 'the handle fills an empty Product handle');
select is((select body->>'cadence' from public.marketing_documents_latest where user_id = 'e2880000-0000-4000-8000-00000000000a' and kind = 'content_strategy'),
  'The founder posts on X, LinkedIn. Three posts a week.', 'the platforms lead the weekly rhythm the planner reads');

-- A second answer replaces the sentence; applying again adds no version.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2880000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_onboarding_answers('{"platforms":["x"]}');
select public.cmo_onboarding_answers('{}');
reset role;
select is((select body->>'cadence' from public.marketing_documents_latest where user_id = 'e2880000-0000-4000-8000-00000000000a' and kind = 'content_strategy'),
  'The founder posts on X only. Three posts a week.', 'one sentence, replaced');
select is((select count(*)::int from public.marketing_documents where user_id = 'e2880000-0000-4000-8000-00000000000a'), 5,
  'two first versions, product v2, content plan v2 and v3: nothing written twice');

-- An empty rhythm keeps the sentence, never a null.
update public.marketing_documents set body = '{"cadence":""}' where user_id = 'e2880000-0000-4000-8000-00000000000a' and kind = 'content_strategy';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2880000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_onboarding_answers('{"platforms":["x","threads"]}');
reset role;
select is((select body->>'cadence' from public.marketing_documents_latest where user_id = 'e2880000-0000-4000-8000-00000000000a' and kind = 'content_strategy'),
  'The founder posts on X, Threads.', 'an empty rhythm gets the sentence, not a null');

select * from finish();
rollback;
