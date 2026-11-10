-- B0 (20270114010000): `cmo_require_paid` is the one paywall rule. Unpaid with no credits is refused with P0402; a plan
-- or credits pass; a founder cannot ask about someone else; anon cannot call it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

insert into auth.users (id, email) values
  ('e2860000-0000-4000-8000-00000000000a', 'rp-a@test.local'),
  ('e2860000-0000-4000-8000-00000000000b', 'rp-b@test.local'),
  ('e2860000-0000-4000-8000-00000000000c', 'rp-c@test.local');
update public.profiles set plan = 'starter' where id = 'e2860000-0000-4000-8000-00000000000b';
update public.profiles set credit_balance = 3 where id = 'e2860000-0000-4000-8000-00000000000c';

select throws_ok($$ select public.cmo_require_paid('e2860000-0000-4000-8000-00000000000a') $$, 'P0402',
  'Pick a plan to keep going. Your first plan and drafts stay here.', 'unpaid with no credits: plan required');
select lives_ok($$ select public.cmo_require_paid('e2860000-0000-4000-8000-00000000000b') $$, 'a paid plan passes');
select lives_ok($$ select public.cmo_require_paid('e2860000-0000-4000-8000-00000000000c') $$, 'credits left from before pass');
select throws_ok($$ select public.cmo_require_paid(null) $$, 'P0002', 'Not found.', 'no user: not found');

select ok(not has_function_privilege('anon', 'public.cmo_require_paid(uuid)', 'execute'), 'anon cannot call it');
select ok(not has_function_privilege('authenticated', 'public.cmo_paid(uuid)', 'execute'), 'founders cannot read another account through cmo_paid');
select ok(not has_function_privilege('authenticated', 'public.cmo_plan_required()', 'execute'), 'nor call the refusal on its own');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2860000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.cmo_require_paid('e2860000-0000-4000-8000-00000000000b') $$, 'P0002', 'Not found.',
  'a founder cannot ask about another account');
select throws_ok($$ select public.cmo_require_paid('e2860000-0000-4000-8000-00000000000a') $$, 'P0402', null,
  'a founder asking about themselves gets the plan code');
reset role;

select * from finish();
rollback;
