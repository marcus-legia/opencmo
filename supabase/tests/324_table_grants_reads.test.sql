-- Web hardening round 4, session A: after 20270129010000_table_grants a signed-in founder still reads their own
-- rows, one object of each kind the app reads (a plain table, a Realtime-subscribed table, a security_invoker
-- view over its base table), and anon is refused outright on what it no longer holds.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

insert into auth.users (id, email) values
  ('e3240000-0000-4000-8000-00000000000a', 'grants-a@test.local'),
  ('e3240000-0000-4000-8000-00000000000b', 'grants-b@test.local');

-- A plain table: work_orders (the week plan, lib/screens/load.ts).
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e3241000-0000-4000-8000-00000000000a', 'e3240000-0000-4000-8000-00000000000a', '2026-11-16', 'post_draft', 'Posts', '{}', 'writer', 'waiting_founder'),
  ('e3241000-0000-4000-8000-00000000000b', 'e3240000-0000-4000-8000-00000000000b', '2026-11-16', 'post_draft', 'Posts', '{}', 'writer', 'waiting_founder');
-- A Realtime table: jobs (components/clipping/useLive.ts subscribes to it).
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e3242000-0000-4000-8000-00000000000a', 'e3240000-0000-4000-8000-00000000000a', 'https://a', 60, 'done'),
  ('e3242000-0000-4000-8000-00000000000b', 'e3240000-0000-4000-8000-00000000000b', 'https://b', 60, 'done');
-- A security_invoker view: marketing_documents_latest over marketing_documents (lib/cmo/state.ts).
insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e3240000-0000-4000-8000-00000000000a', 'product', 1, '{"name": "A"}', 'user'),
  ('e3240000-0000-4000-8000-00000000000b', 'product', 1, '{"name": "B"}', 'user');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3240000-0000-4000-8000-00000000000a","role":"authenticated"}';

select is((select array_agg(id) from public.work_orders), array['e3241000-0000-4000-8000-00000000000a'::uuid],
  'a founder reads their own work orders, and only theirs');
select is((select array_agg(id) from public.jobs), array['e3242000-0000-4000-8000-00000000000a'::uuid],
  'a founder reads their own jobs (Realtime needs this select)');
select is((select array_agg(body->>'name') from public.marketing_documents_latest), array['A'],
  'a founder reads their documents through the security_invoker view');
select throws_ok($$ delete from public.work_orders $$, '42501', null, 'a founder cannot delete rows directly');
select throws_ok($$ truncate public.jobs $$, '42501', null, 'nor truncate a table (TRUNCATE ignores RLS)');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok($$ select count(*) from public.jobs $$, '42501', null, 'anon is refused on jobs');
select throws_ok($$ select count(*) from public.work_orders $$, '42501', null, 'anon is refused on work_orders');
select throws_ok($$ select count(*) from public.marketing_documents_latest $$, '42501', null, 'anon is refused on the view');
select lives_ok($$ select count(*) from public.billing_catalog $$, 'anon still reads the billing catalogue (landing prices)');

select * from finish();
rollback;
