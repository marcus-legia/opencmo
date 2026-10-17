-- is_paid (20261210100000): starter and creator are paid, anything else is not; a user cannot ask
-- about someone else; anon cannot call it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

insert into auth.users (id, email) values
  ('e1750000-0000-4000-8000-00000000000a', 'paid-free@test.local'),
  ('e1750000-0000-4000-8000-00000000000b', 'paid-starter@test.local'),
  ('e1750000-0000-4000-8000-00000000000c', 'paid-creator@test.local'),
  ('e1750000-0000-4000-8000-00000000000d', 'paid-odd@test.local');
update public.profiles set plan = 'starter' where id = 'e1750000-0000-4000-8000-00000000000b';
update public.profiles set plan = 'creator' where id = 'e1750000-0000-4000-8000-00000000000c';
update public.profiles set plan = 'pro' where id = 'e1750000-0000-4000-8000-00000000000d';

set local role service_role;
select ok(not public.is_paid('e1750000-0000-4000-8000-00000000000a'), 'free is not paid');
select ok(public.is_paid('e1750000-0000-4000-8000-00000000000b'), 'starter is paid');
select ok(public.is_paid('e1750000-0000-4000-8000-00000000000c'), 'creator is paid');
select ok(not public.is_paid('e1750000-0000-4000-8000-00000000000d'), 'an unknown plan id is not paid');
select ok(not public.is_paid(gen_random_uuid()), 'no profile is not paid');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1750000-0000-4000-8000-00000000000b"}';
select ok(public.is_paid('e1750000-0000-4000-8000-00000000000b'), 'a paid user sees their own plan');
select ok(not public.is_paid('e1750000-0000-4000-8000-00000000000c'), 'another user''s id answers false');
set local request.jwt.claims = '{"sub":"e1750000-0000-4000-8000-00000000000a"}';
select ok(not public.is_paid('e1750000-0000-4000-8000-00000000000a'), 'a free user sees false');

reset role;
select ok(not has_function_privilege('anon', 'public.is_paid(uuid)', 'execute'), 'anon cannot call is_paid');

select * from finish();
rollback;
