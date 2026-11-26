-- 20270206060000: storing a posting account needs a plan. Zernio bills per connected account per day, so a free
-- account must not connect one; an account already connected may still be refreshed after its plan lapses.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(6);

insert into auth.users (id, email) values ('e3610000-0000-4000-8000-00000000000a', 'connectplan@test.local');
select public.zernio_profile_save('e3610000-0000-4000-8000-00000000000a', 'prof-361');

select throws_ok($$ select public.social_account_save('e3610000-0000-4000-8000-00000000000a', 'x', '@free', null, 'acc-361-x') $$,
  'P0402', null, 'a free account cannot connect a posting account');
select is((select count(*)::int from public.social_accounts where user_id = 'e3610000-0000-4000-8000-00000000000a'), 0,
  'and nothing is stored');

update public.profiles set plan = 'starter' where id = 'e3610000-0000-4000-8000-00000000000a';
select lives_ok($$ select public.social_account_save('e3610000-0000-4000-8000-00000000000a', 'x', '@paid', null, 'acc-361-x') $$,
  'a paid account connects');

-- The plan lapses while X is connected.
update public.profiles set plan = 'free', credit_balance = 0 where id = 'e3610000-0000-4000-8000-00000000000a';
select is((public.social_account_save('e3610000-0000-4000-8000-00000000000a', 'x', '@renamed', null, 'acc-361-x')).handle,
  '@renamed', 'refreshing the same connected account still works without a plan');
select throws_ok($$ select public.social_account_save('e3610000-0000-4000-8000-00000000000a', 'x', '@other', null, 'acc-361-x2') $$,
  'P0402', null, 'but swapping in another account needs a plan');
select throws_ok($$ select public.social_account_save('e3610000-0000-4000-8000-00000000000a', 'threads', '@t', null, 'acc-361-th') $$,
  'P0402', null, 'and so does a new platform');

select * from finish();
rollback;
