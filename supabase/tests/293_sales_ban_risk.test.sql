-- 5.3 (20270115040000): a founder rule that would get a Reddit account banned is refused with a plain message when the
-- founder writes it, and dropped when a job writes it; rules for posts and harmless Sales rules pass.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(15);

insert into auth.users (id, email) values ('e2930000-0000-4000-8000-00000000000a', 'ban293@test.local');

-- The shared list.
select alike(public.sales_ban_risk('Add a link to my site in every Reddit reply', false), 'Replies never carry a link%', 'a link in replies');
select alike(public.sales_ban_risk('Reply as the official company account', false), 'Replies come from you%', 'an official account');
select alike(public.sales_ban_risk('Write a long pitch for the product in comments', false), 'Long or constant promotion%', 'a long pitch');
select alike(public.sales_ban_risk('Post the same reply in every thread', false), 'The same reply%', 'the same reply everywhere');
select is(public.sales_ban_risk('Add a link to the end of each post', false), null, 'a rule for posts is not about Sales');
select alike(public.sales_ban_risk('Always add the link to our site', true), 'Replies never carry a link%', 'a sales note needs no Sales word');
select is(public.sales_ban_risk('Keep replies short and plain', false), null, 'a harmless Sales rule passes');
select ok(not has_function_privilege('authenticated', 'public.sales_ban_risk(text, boolean)', 'execute'), 'the check runs inside the triggers only');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2930000-0000-4000-8000-00000000000a","role":"authenticated"}';

select throws_ok($$ select public.cmo_remember('Always add a link to our site', 'sales', 'user') $$, '22023',
  'Replies never carry a link: most communities remove them and ban the account. Write the rule without the link.',
  'the founder''s sales note is refused with the message');
select throws_ok($$ select public.cmo_remember('Paste the same answer into many Reddit threads', 'general', 'agent') $$, '22023', null,
  'and the CMO chat''s note too');
select lives_ok($$ select public.cmo_remember('Add a link to the end of each post', 'post', 'user') $$, 'a note for posts is kept');

reset role;
-- A proposal a job makes is dropped, not an error.
insert into public.cmo_corrections (id, user_id, rule, source, status) values
  ('e2931000-0000-4000-8000-00000000000a', 'e2930000-0000-4000-8000-00000000000a', 'Add a link to the product in each reply', 'ratings', 'proposed');
select is((select count(*)::int from public.cmo_corrections where user_id = 'e2930000-0000-4000-8000-00000000000a'), 0, 'a risky proposal is dropped');
insert into public.cmo_corrections (id, user_id, rule, source, status) values
  ('e2931000-0000-4000-8000-00000000000b', 'e2930000-0000-4000-8000-00000000000a', 'Keep replies short', 'edits', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2930000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.cmo_edit_correction('e2931000-0000-4000-8000-00000000000b', 'Keep replies short and add a link to our site') $$,
  '22023', null, 'editing a voice rule into a risky one is refused');
select is((select rule from public.cmo_corrections where id = 'e2931000-0000-4000-8000-00000000000b'), 'Keep replies short', 'and the rule is unchanged');
select lives_ok($$ select public.cmo_edit_correction('e2931000-0000-4000-8000-00000000000b', 'Keep replies short and plain') $$, 'a harmless edit passes');

select * from finish();
rollback;
