-- Review of #238, finding 6 (20270131020005): a card whose community now says stay out is marked skip once, by the
-- founder's own reply-drafts run; a drafted card or another founder's card is left alone; founders cannot call it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(6);

insert into auth.users (id, email) values
  ('e3340000-0000-4000-8000-00000000000a', 'sk-a@test.local'),
  ('e3340000-0000-4000-8000-00000000000b', 'sk-b@test.local');
insert into public.cmo_runs (id, user_id, kind, status, input, credits) values
  ('e3340000-0000-4000-8000-0000000000a0', 'e3340000-0000-4000-8000-00000000000a', 'sales_scan', 'done', '{}', 0),
  ('e3340000-0000-4000-8000-0000000000a1', 'e3340000-0000-4000-8000-00000000000a', 'sales_reply_drafts', 'running', '{}', 0),
  ('e3340000-0000-4000-8000-0000000000b1', 'e3340000-0000-4000-8000-00000000000b', 'sales_reply_drafts', 'running', '{}', 0);
insert into public.opportunities (id, user_id, run_id, url, community, title, score, reply, rule, rule_why) values
  ('e3340000-0000-4000-8000-0000000000c1', 'e3340000-0000-4000-8000-00000000000a', 'e3340000-0000-4000-8000-0000000000a0',
   'https://www.reddit.com/r/nopromo/comments/c1/x/', 'nopromo', 'Undrafted', 80, '', 'safe', null),
  ('e3340000-0000-4000-8000-0000000000c2', 'e3340000-0000-4000-8000-00000000000a', 'e3340000-0000-4000-8000-0000000000a0',
   'https://www.reddit.com/r/nopromo/comments/c2/x/', 'nopromo', 'Drafted', 80, 'Already here.', 'safe', null);

select ok(not has_function_privilege('authenticated', 'public.cmo_mark_opportunity_skip(uuid, uuid, uuid, text)', 'execute'),
  'founders cannot call it');
select ok(public.cmo_mark_opportunity_skip('e3340000-0000-4000-8000-00000000000a', 'e3340000-0000-4000-8000-0000000000a1',
  'e3340000-0000-4000-8000-0000000000c1', 'r/nopromo: no replies from vendors'), 'an undrafted card is marked skip');
select is((select rule || ' / ' || rule_why from public.opportunities where id = 'e3340000-0000-4000-8000-0000000000c1'),
  'skip / r/nopromo: no replies from vendors', 'with the community''s words');
select ok(not public.cmo_mark_opportunity_skip('e3340000-0000-4000-8000-00000000000a', 'e3340000-0000-4000-8000-0000000000a1',
  'e3340000-0000-4000-8000-0000000000c2', 'x'), 'a drafted card is left alone');
select throws_ok($$ select public.cmo_mark_opportunity_skip('e3340000-0000-4000-8000-00000000000a',
  'e3340000-0000-4000-8000-0000000000b1', 'e3340000-0000-4000-8000-0000000000c1', 'x') $$, 'P0002', 'Run not found.',
  'another founder''s run cannot mark it');
select is((select rule from public.opportunities where id = 'e3340000-0000-4000-8000-0000000000c2'), 'safe', 'the drafted card keeps its rule');

select * from finish();
rollback;
