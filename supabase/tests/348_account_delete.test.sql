-- Wave 4a A2 (20270202020000): `account_delete(p_email)` lets a founder delete their own account through the same
-- purge as the 30-day cleanup. A wrong email, a plan that can still charge, or running work refuse it; a match queues
-- the files and opens a row in the purge log; the cleanup returns the account until Auth deletes it; once the auth user
-- is gone no row of the user is left and the log row is closed.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(17);

insert into auth.users (id, email) values
  ('e3480000-0000-4000-8000-00000000000a', 'Del-Me@Test.local'),
  ('e3480000-0000-4000-8000-00000000000b', 'del-paid@test.local'),
  ('e3480000-0000-4000-8000-00000000000c', 'del-busy@test.local'),
  ('e3480000-0000-4000-8000-00000000000d', 'del-cancelled@test.local');

insert into public.billing_catalog (creem_product_id, slug, kind, plan_id, credits, price_cents, interval, sort) values
  ('prod_348_month', 'test-348-month', 'plan', 'starter', 100, 6900, 'month', 900);
insert into public.creem_subscriptions
  (subscription_id, customer_id, user_id, product_id, plan, interval, status, current_period_end, provider_event_at,
   status_priority, event_id) values
  ('sub_348_b', 'cus_348_b', 'e3480000-0000-4000-8000-00000000000b', 'prod_348_month', 'starter', 'month', 'active',
   now() + interval '10 days', now(), 0, 'evt_348_b'),
  ('sub_348_d', 'cus_348_d', 'e3480000-0000-4000-8000-00000000000d', 'prod_348_month', 'starter', 'month',
   'scheduled_cancel', now() + interval '10 days', now(), 0, 'evt_348_d');

insert into public.tasks (user_id, kind, request_id, status) values
  ('e3480000-0000-4000-8000-00000000000c', 'render_document', gen_random_uuid(), 'running');

-- The founder's things: files, a document, a run, a credit.
insert into storage.objects (bucket_id, name, owner) values
  ('media', 'e3480000-0000-4000-8000-00000000000a/j/a.png', 'e3480000-0000-4000-8000-00000000000a'),
  ('brand', 'e3480000-0000-4000-8000-00000000000a/logo.png', 'e3480000-0000-4000-8000-00000000000a'),
  ('brand', 'e3480000-0000-4000-8000-00000000000b/logo.png', 'e3480000-0000-4000-8000-00000000000b');
insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e3480000-0000-4000-8000-00000000000a', 'product', 1, '{}', 'agent');
insert into public.cmo_runs (user_id, kind, status, credits) values
  ('e3480000-0000-4000-8000-00000000000a', 'sales_scan', 'done', 0);
insert into public.credit_ledger (user_id, delta, reason, external_id) values
  ('e3480000-0000-4000-8000-00000000000a', 5, 'test', 'test:348:grant');

-- Rows of a user in every public table that names one (`user_id`, or a profile's `id`). Two keep the id on purpose:
-- the purge log, and the file queue until the cleanup's sweep removes the files and their rows.
create function pg_temp.rows_of(p_user uuid) returns integer language plpgsql as $$
declare r record; n integer := 0; c integer;
begin
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
      and c.table_name not in ('account_deletions', 'storage_deletions')
  loop
    execute format('select count(*) from public.%I where user_id = $1', r.table_name) into c using p_user;
    n := n + c;
  end loop;
  return n + (select count(*)::int from public.profiles where id = p_user);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3480000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.account_delete('someone-else@test.local') $$, '22023',
  'The email you typed is not the one on this account.', 'a wrong email is refused');
select throws_ok($$ select public.account_delete(null) $$, '22023', null, 'no email is refused');

set local request.jwt.claims = '{"sub":"e3480000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.account_delete('del-paid@test.local') $$, 'P0001',
  'Cancel your plan first, on the Billing page. Then you can delete your account.', 'an active plan is cancelled first');

set local request.jwt.claims = '{"sub":"e3480000-0000-4000-8000-00000000000c","role":"authenticated"}';
select throws_ok($$ select public.account_delete('del-busy@test.local') $$, 'P0001',
  'A video is still being processed. Try again when it is done.', 'running work finishes first');

-- A match: case and spaces do not matter.
set local request.jwt.claims = '{"sub":"e3480000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((public.account_delete('  del-me@test.local ') ->> 'files')::int, 2, 'the typed email matches and both files are queued');
select is((public.account_delete('del-me@test.local') ->> 'files')::int, 0, 'asking twice queues nothing more');

-- A plan set to cancel at the period end charges nothing more.
set local request.jwt.claims = '{"sub":"e3480000-0000-4000-8000-00000000000d","role":"authenticated"}';
select lives_ok($$ select public.account_delete('del-cancelled@test.local') $$, 'a plan set to cancel does not block');
reset role;

select is((select count(*)::int from public.account_deletions
           where user_id = 'e3480000-0000-4000-8000-00000000000a' and source = 'self' and done_at is null), 1,
  'one open row in the purge log');
select set_eq(
  $$ select bucket || ':' || path from public.storage_deletions where user_id = 'e3480000-0000-4000-8000-00000000000a' $$,
  $$ values ('media:e3480000-0000-4000-8000-00000000000a/j/a.png'), ('brand:e3480000-0000-4000-8000-00000000000a/logo.png') $$,
  'the founder''s files are queued, nobody else''s');
select is((select count(*)::int from public.account_deletions where user_id in
           ('e3480000-0000-4000-8000-00000000000b', 'e3480000-0000-4000-8000-00000000000c')), 0,
  'a refused deletion logs nothing');

-- The cleanup returns the asked accounts, so a failed `deleteUser` after the route is retried.
create temporary table purged as select * from public.purge_unpaid_accounts(500) as id;
select ok((select count(*) = 2 from purged where id in
           ('e3480000-0000-4000-8000-00000000000a', 'e3480000-0000-4000-8000-00000000000d')),
  'the cleanup returns accounts whose deletion was asked');
select ok(not exists (select 1 from purged where id in
           ('e3480000-0000-4000-8000-00000000000b', 'e3480000-0000-4000-8000-00000000000c')),
  'nor anyone who did not ask');

-- What `auth.admin.deleteUser` does: the cascade from auth.users.
delete from auth.users where id = 'e3480000-0000-4000-8000-00000000000a';
select is(pg_temp.rows_of('e3480000-0000-4000-8000-00000000000a'), 0, 'no row of the user is left');
select is((select count(*)::int from public.storage_deletions where user_id = 'e3480000-0000-4000-8000-00000000000a'), 2,
  'the files stay queued for the sweep after the user is gone');
select isnt((select done_at from public.account_deletions where user_id = 'e3480000-0000-4000-8000-00000000000a'), null,
  'the purge log row is closed');

select ok(not has_function_privilege('anon', 'public.account_delete(text)', 'execute'), 'anon cannot delete an account');
select ok(not has_function_privilege('authenticated', 'public.account_purge_files(uuid)', 'execute'),
  'users cannot queue another account''s files');

select * from finish();
rollback;
