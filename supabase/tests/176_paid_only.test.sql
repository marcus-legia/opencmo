-- Paid-only gates (20261210101000): free users get no API key, and `brain = 'claude'` is free only
-- for paid users.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

insert into auth.users (id, email) values
  ('e1760000-0000-4000-8000-00000000000a', 'paid-only-free@test.local'),
  ('e1760000-0000-4000-8000-00000000000b', 'paid-only-paid@test.local');
update public.profiles set plan = 'starter' where id = 'e1760000-0000-4000-8000-00000000000b';
insert into public.credit_ledger (user_id, delta, reason) values
  ('e1760000-0000-4000-8000-00000000000a', 5, 'test grant'),
  ('e1760000-0000-4000-8000-00000000000b', 5, 'test grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1760000-0000-4000-8000-00000000000a"}';
select throws_ok($$ select public.create_api_key('Claude Desktop') $$, 'P0001', 'API keys are part of the paid plans.', 'a free user cannot create an API key');
select is((select (r).credits from (select public.enqueue_cmo_run('post_draft', '{"brain":"claude"}') as r) x), 1,
  'brain = claude costs a free user the normal price');

set local request.jwt.claims = '{"sub":"e1760000-0000-4000-8000-00000000000b"}';
select ok((select public.create_api_key('Claude Desktop') ->> 'key') ~ '^ocm_', 'a paid user can create an API key');
select is((select (r).credits from (select public.enqueue_cmo_run('post_draft', '{"brain":"claude"}') as r) x), 0,
  'brain = claude stays free for a paid user');
select is((select (r).credits from (select public.enqueue_cmo_run('plan_week', '{}') as r) x), 1,
  'a paid user without the flag pays as before');

reset role;
select is(public.credit_balance('e1760000-0000-4000-8000-00000000000a'), 4, 'the free user''s run held one credit');
select is(public.credit_balance('e1760000-0000-4000-8000-00000000000b'), 4, 'the paid user''s claude run held nothing');

select * from finish();
rollback;
