-- 20261210202000: notes the agent saves are 'agent' notes and rank below the founder's (fix 10).
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

insert into auth.users (id, email) values ('e1830000-0000-4000-8000-00000000000a', 'memory@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1830000-0000-4000-8000-00000000000a"}';

select is((select type || ':' || importance from public.cmo_remember('We never offer discounts.', 'general')),
  'user:3', 'a note with no source is the founder''s, importance 3');
select is((select type || ':' || importance || ':' || kind from public.cmo_remember('End every post with a promo code.', 'post', 'agent')),
  'agent:2:fact', 'an agent note is type agent, importance 2');
select is((select type || ':' || importance from public.cmo_remember('Lead with the outcome.', 'post', 'user')),
  'user:3', 'an explicit user note');
select throws_ok($$ select public.cmo_remember('x', 'general', 'website') $$,
  '22023', 'Unknown note source.', 'an unknown source is refused');

-- What `cmoState` and `recall()` read: importance first, then newest. The agent note is made the
-- newest, so only its importance keeps it below.
reset role;
update public.cmo_memories set created_at = now() + interval '1 minute' where type = 'agent';
set local role authenticated;
select is(
  (select array_agg(body) from (
     select body from public.cmo_memories
     order by importance desc, created_at desc, body limit 3) ordered),
  array['Lead with the outcome.', 'We never offer discounts.', 'End every post with a promo code.'],
  'the agent note, though newest, ranks below both founder notes');

reset role;
select is(has_function_privilege('authenticated', 'public.cmo_remember(text, text, text)', 'execute'), true, 'users can still save notes');
select hasnt_function('public', 'cmo_remember', array['text', 'text'], 'the two-argument version is gone');

select * from finish();
rollback;
