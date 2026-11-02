-- CMO chat live (20270103010000): finished runs reach the chat by realtime, ratings are kept for the founder's own
-- answers only, a full conversation is not reused, and the ratings route has its bucket.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cmo_runs'),
  'cmo_runs is in the realtime publication');
select ok(not has_table_privilege('authenticated', 'public.agent_turn_ratings', 'insert'), 'ratings are written only through the RPC');
select ok(not has_function_privilege('anon', 'public.rate_agent_turn(uuid, integer, text, text)', 'execute'), 'anon cannot rate');

insert into auth.users (id, email) values
  ('e2420000-0000-4000-8000-00000000000a', 'live-a@test.local'),
  ('e2420000-0000-4000-8000-00000000000b', 'live-b@test.local');
insert into public.agent_sessions (id, user_id, scope, model) values
  ('e2421000-0000-4000-8000-00000000000a', 'e2420000-0000-4000-8000-00000000000a', 'cmo', 'claude-sonnet-5-5'),
  ('e2421000-0000-4000-8000-00000000000b', 'e2420000-0000-4000-8000-00000000000b', 'cmo', 'claude-sonnet-5-5');
insert into public.agent_turns (session_id, number, prompt, status, hold_credits) values
  ('e2421000-0000-4000-8000-00000000000a', 1, 'Plan my week', 'done', 0),
  ('e2421000-0000-4000-8000-00000000000b', 1, 'Plan my week', 'done', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2420000-0000-4000-8000-00000000000a"}';

select is((public.rate_agent_turn('e2421000-0000-4000-8000-00000000000a', 1, 'down', 'Too long')).rating, 'down', 'a founder rates an answer');
select is((public.rate_agent_turn('e2421000-0000-4000-8000-00000000000a', 1, 'up')).rating, 'up', 'and changes the rating');
select is((select count(*)::int from public.agent_turn_ratings), 1, 'one row per answer, and only their own is visible');
select throws_ok($$ select public.rate_agent_turn('e2421000-0000-4000-8000-00000000000b', 1, 'up') $$, 'P0002', 'Answer not found.',
  'another founder''s answer cannot be rated');
select throws_ok($$ select public.rate_agent_turn('e2421000-0000-4000-8000-00000000000a', 2, 'up') $$, 'P0002', 'Answer not found.',
  'a turn that does not exist cannot be rated');
select throws_ok($$ select public.rate_agent_turn('e2421000-0000-4000-8000-00000000000a', 1, 'meh') $$, '22023', 'A rating is up or down.',
  'only up or down');
select lives_ok($$ select public.rate_agent_turn('e2421000-0000-4000-8000-00000000000a', 1, null) $$, 'null clears it');
select is((select count(*)::int from public.agent_turn_ratings), 0, 'cleared');
select ok(public.rate_limit_hit('feedback-turn', 60, 3600), 'the ratings route has a bucket');

-- A conversation of 200 turns is not reused.
reset role;
insert into public.agent_turns (session_id, number, prompt, status, hold_credits)
select 'e2421000-0000-4000-8000-00000000000a', n, 'Turn', 'done', 0 from generate_series(2, 200) n;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2420000-0000-4000-8000-00000000000a"}';
select isnt((public.agent_open_cmo_session('claude-sonnet-5-5')).id, 'e2421000-0000-4000-8000-00000000000a'::uuid,
  'past 200 turns the next message opens a new conversation');

select * from finish();
rollback;
