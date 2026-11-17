-- Web hardening round 3, A2 (20270127010000): the eight policies the advisor flagged (auth_rls_initplan) now
-- call auth.uid() once per query through `(select auth.uid())`. Same names, commands and roles; this proves each
-- still shows a user their own rows and hides another user's.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(28);

-- ================================================================ seed two users, one row each per table
insert into auth.users (id, email) values
  ('e3190000-0000-4000-8000-00000000000a', 'rls-a@test.local'),
  ('e3190000-0000-4000-8000-00000000000b', 'rls-b@test.local');

insert into public.jobs (id, user_id, source_url) values
  ('e3191000-0000-4000-8000-00000000000a', 'e3190000-0000-4000-8000-00000000000a', 'https://a'),
  ('e3191000-0000-4000-8000-00000000000b', 'e3190000-0000-4000-8000-00000000000b', 'https://b');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e3192000-0000-4000-8000-00000000000a', 'e3191000-0000-4000-8000-00000000000a', 0, 0, 10, 0, 10),
  ('e3192000-0000-4000-8000-00000000000b', 'e3191000-0000-4000-8000-00000000000b', 0, 0, 10, 0, 10);
insert into public.scene_codes (user_id, hash, code) values
  ('e3190000-0000-4000-8000-00000000000a', repeat('a', 64), 'a'),
  ('e3190000-0000-4000-8000-00000000000b', repeat('b', 64), 'b');
insert into public.editor_skills (user_id, name, description, body) values
  ('e3190000-0000-4000-8000-00000000000a', 'skill-a', 'a', 'a'),
  ('e3190000-0000-4000-8000-00000000000b', 'skill-b', 'b', 'b');
insert into public.editor_feedback (user_id, category, summary) values
  ('e3190000-0000-4000-8000-00000000000a', 'suggestion', 'a'),
  ('e3190000-0000-4000-8000-00000000000b', 'suggestion', 'b');
insert into public.mcp_grants (user_id, client_id) values
  ('e3190000-0000-4000-8000-00000000000a', 'client-a'),
  ('e3190000-0000-4000-8000-00000000000b', 'client-b');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e3193000-0000-4000-8000-00000000000a', 'e3190000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
   'build_video', 'Video', '{"objective":"a"}', 'studio', 'running'),
  ('e3193000-0000-4000-8000-00000000000b', 'e3190000-0000-4000-8000-00000000000b', date_trunc('week', current_date)::date,
   'build_video', 'Video', '{"objective":"b"}', 'studio', 'running');
insert into public.work_order_usage (user_id, order_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, micro_usd) values
  ('e3190000-0000-4000-8000-00000000000a', 'e3193000-0000-4000-8000-00000000000a', 'm', 1, 1, 0, 0, 1),
  ('e3190000-0000-4000-8000-00000000000b', 'e3193000-0000-4000-8000-00000000000b', 'm', 1, 1, 0, 0, 1);
insert into public.credit_orders (user_id, kind, estimate_credits, request_id) values
  ('e3190000-0000-4000-8000-00000000000a', 'long_take', 1, gen_random_uuid()),
  ('e3190000-0000-4000-8000-00000000000b', 'long_take', 1, gen_random_uuid());

-- ================================================================ the policies' text
-- pg_policies prints a wrapped call as "( SELECT auth.uid() AS uid)"; a bare "auth.uid()" outside it is per row.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and policyname in ('đọc job của chính mình', 'đọc clip thuộc job của mình', 'đọc code cảnh của mình',
                        'đọc skill của mình', 'đọc phản hồi của mình', 'mcp_grants_select_own',
                        'read own order usage', 'credit_orders_own')
     and qual like '%( SELECT auth.uid() AS uid)%'
     and replace(qual, '( SELECT auth.uid() AS uid)', '') not like '%auth.uid()%'),
  8, 'all eight policies call auth.uid() through a select'
);
select is(
  (select string_agg(tablename || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by tablename) from pg_policies
   where schemaname = 'public'
     and policyname in ('đọc job của chính mình', 'đọc clip thuộc job của mình', 'đọc code cảnh của mình',
                        'đọc skill của mình', 'đọc phản hồi của mình', 'mcp_grants_select_own',
                        'read own order usage', 'credit_orders_own')),
  'clips:SELECT:public credit_orders:SELECT:authenticated editor_feedback:SELECT:authenticated editor_skills:SELECT:public jobs:SELECT:public mcp_grants:SELECT:authenticated scene_codes:SELECT:authenticated work_order_usage:SELECT:authenticated',
  'commands and roles are unchanged'
);

-- ================================================================ user A sees only A's rows
-- 20270129010000_table_grants took select on these three away from users (no page reads them); their policies stay,
-- so grant it inside this rolled-back transaction to keep testing the policy expressions themselves.
grant select on public.scene_codes, public.editor_feedback, public.work_order_usage to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3190000-0000-4000-8000-00000000000a"}';

select is((select count(*)::int from public.jobs where user_id = 'e3190000-0000-4000-8000-00000000000a'), 1, 'A reads own job');
select is((select count(*)::int from public.jobs where user_id = 'e3190000-0000-4000-8000-00000000000b'), 0, 'A does not see B''s job');
select is((select count(*)::int from public.clips where id = 'e3192000-0000-4000-8000-00000000000a'), 1, 'A reads own clip');
select is((select count(*)::int from public.clips where id = 'e3192000-0000-4000-8000-00000000000b'), 0, 'A does not see B''s clip');
select is((select count(*)::int from public.scene_codes where user_id = 'e3190000-0000-4000-8000-00000000000a'), 1, 'A reads own scene code');
select is((select count(*)::int from public.scene_codes where user_id = 'e3190000-0000-4000-8000-00000000000b'), 0, 'A does not see B''s scene code');
select is((select count(*)::int from public.editor_skills where user_id = 'e3190000-0000-4000-8000-00000000000a'), 1, 'A reads own skill');
select is((select count(*)::int from public.editor_skills where user_id = 'e3190000-0000-4000-8000-00000000000b'), 0, 'A does not see B''s skill');
select is((select count(*)::int from public.editor_feedback where user_id = 'e3190000-0000-4000-8000-00000000000a'), 1, 'A reads own feedback');
select is((select count(*)::int from public.editor_feedback where user_id = 'e3190000-0000-4000-8000-00000000000b'), 0, 'A does not see B''s feedback');
select is((select count(*)::int from public.mcp_grants where user_id = 'e3190000-0000-4000-8000-00000000000a'), 1, 'A reads own MCP grant');
select is((select count(*)::int from public.mcp_grants where user_id = 'e3190000-0000-4000-8000-00000000000b'), 0, 'A does not see B''s MCP grant');
select is((select count(*)::int from public.work_order_usage where user_id = 'e3190000-0000-4000-8000-00000000000a'), 1, 'A reads own order usage');
select is((select count(*)::int from public.work_order_usage where user_id = 'e3190000-0000-4000-8000-00000000000b'), 0, 'A does not see B''s order usage');
select is((select count(*)::int from public.credit_orders where user_id = 'e3190000-0000-4000-8000-00000000000a'), 1, 'A reads own credit order');
select is((select count(*)::int from public.credit_orders where user_id = 'e3190000-0000-4000-8000-00000000000b'), 0, 'A does not see B''s credit order');

-- ================================================================ user B, the other way round (a sample)
set local request.jwt.claims = '{"sub":"e3190000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.jobs), 1, 'B sees exactly one job');
select is((select user_id from public.jobs), 'e3190000-0000-4000-8000-00000000000b'::uuid, 'and it is B''s');
select is((select count(*)::int from public.clips), 1, 'B sees exactly one clip');
select is((select count(*)::int from public.credit_orders), 1, 'B sees exactly one credit order');

-- ================================================================ a purging job hides itself and its clips
reset role;
update public.jobs set purging_at = now() where id = 'e3191000-0000-4000-8000-00000000000b';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3190000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.jobs), 0, 'a purging job is hidden from its owner');
select is((select count(*)::int from public.clips), 0, 'and so are its clips');

-- ================================================================ anon sees nothing
reset role;
set local role anon;
set local request.jwt.claims = '{}';
-- Since 20270129010000_table_grants anon holds no grant on either table: refused before any policy runs.
select throws_ok($$ select count(*) from public.jobs $$, '42501', null, 'anon has no grant on jobs');
select throws_ok($$ select count(*) from public.clips $$, '42501', null, 'anon has no grant on clips');
-- Both policies are TO public, so they still apply to anon: grant inside this rolled-back transaction and check them.
reset role;
grant select on public.jobs, public.clips to anon;
set local role anon;
select is((select count(*)::int from public.jobs), 0, 'anon sees no job');
select is((select count(*)::int from public.clips), 0, 'anon sees no clip');

select * from finish();
rollback;
