-- Free scan A5 (20270131010002): `cmo_save_opportunity_reply` fills an undrafted card once, from the founder's own
-- `sales_reply_drafts` run; it may tighten the rule to help only, never loosen it; founders cannot call it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(11);

insert into auth.users (id, email) values
  ('e3280000-0000-4000-8000-00000000000a', 'rd-a@test.local'),
  ('e3280000-0000-4000-8000-00000000000b', 'rd-b@test.local');
insert into public.cmo_runs (id, user_id, kind, status, input, credits) values
  ('e3280000-0000-4000-8000-0000000000a0', 'e3280000-0000-4000-8000-00000000000a', 'sales_scan', 'done', '{}', 0),
  ('e3280000-0000-4000-8000-0000000000a1', 'e3280000-0000-4000-8000-00000000000a', 'sales_reply_drafts', 'running', '{}', 1),
  ('e3280000-0000-4000-8000-0000000000b1', 'e3280000-0000-4000-8000-00000000000b', 'sales_reply_drafts', 'running', '{}', 1);
insert into public.opportunities (id, user_id, run_id, url, community, title, score, reply, rule, rule_why) values
  ('e3280000-0000-4000-8000-0000000000c1', 'e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000a0',
   'https://www.reddit.com/r/freelance/comments/c1/x/', 'freelance', 'Undrafted', 80, '', 'safe', 'r/freelance: you may name it'),
  ('e3280000-0000-4000-8000-0000000000c2', 'e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000a0',
   'https://www.reddit.com/r/freelance/comments/c2/x/', 'freelance', 'Drafted', 80, 'Already here.', 'no_product_mention', null),
  ('e3280000-0000-4000-8000-0000000000c3', 'e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000a0',
   'https://www.reddit.com/r/freelance/comments/c3/x/', 'freelance', 'Undrafted too', 75, '', 'safe', 'r/freelance: you may name it');

select ok(not has_function_privilege('authenticated',
  'public.cmo_save_opportunity_reply(uuid, uuid, uuid, text, jsonb, text, text)', 'execute'), 'founders cannot call it');

select ok(public.cmo_save_opportunity_reply('e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000a1',
  'e3280000-0000-4000-8000-0000000000c1', '  Send the reminder on day 3.  ', '{"model":"fake","prompt_version":"v1"}'), 'an undrafted card gets its reply');
select is((select reply from public.opportunities where id = 'e3280000-0000-4000-8000-0000000000c1'), 'Send the reminder on day 3.', 'trimmed');
select is((select gen->>'model' from public.opportunities where id = 'e3280000-0000-4000-8000-0000000000c1'), 'fake', 'with its model');
select ok(not public.cmo_save_opportunity_reply('e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000a1',
  'e3280000-0000-4000-8000-0000000000c1', 'Again', '{}'), 'a drafted card is not written twice');
select ok(not public.cmo_save_opportunity_reply('e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000a1',
  'e3280000-0000-4000-8000-0000000000c2', 'Over it', '{}'), 'a card the scan drafted is left alone');

select ok(public.cmo_save_opportunity_reply('e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000a1',
  'e3280000-0000-4000-8000-0000000000c3', 'Help only.', '{}', 'no_product_mention', 'Help only this time'), 'the rule tightens to help only');
select is((select rule || ' / ' || rule_why from public.opportunities where id = 'e3280000-0000-4000-8000-0000000000c3'),
  'no_product_mention / Help only this time', 'with its reason');
select throws_ok($$ select public.cmo_save_opportunity_reply('e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000a1',
  'e3280000-0000-4000-8000-0000000000c3', 'Name it', '{}', 'safe') $$, '22023', null, 'never loosens a rule');
select throws_ok($$ select public.cmo_save_opportunity_reply('e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000b1',
  'e3280000-0000-4000-8000-0000000000c3', 'x', '{}') $$, 'P0002', null, 'another account''s run is refused');
select throws_ok($$ select public.cmo_save_opportunity_reply('e3280000-0000-4000-8000-00000000000a', 'e3280000-0000-4000-8000-0000000000a1',
  'e3280000-0000-4000-8000-0000000000c3', '   ', '{}') $$, '22023', null, 'an empty reply is refused');

select * from finish();
rollback;
