-- Paid-only gates (20261210101000): free users get no API key. `brain = 'claude'` was free for paid users until the
-- Claude inbox went (20270124010000): now it is ignored and every founder pays the normal price.
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
select is((select (r).credits from (select public.enqueue_cmo_run('post_draft', '{"brain":"claude"}') as r) x), 1,
  'brain = claude no longer makes a paid user''s run free');
select is((select (r).credits from (select public.enqueue_cmo_run('plan_week', '{}') as r) x), 1,
  'a paid user without the flag pays as before');

reset role;
select is(public.credit_balance('e1760000-0000-4000-8000-00000000000a'), 4, 'the free user''s run held one credit');
select is(public.credit_balance('e1760000-0000-4000-8000-00000000000b'), 3, 'the paid user''s two runs held one credit each');

select * from finish();
rollback;
