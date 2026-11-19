-- Wave 3 A3 (20270201020000): people. "I replied" keeps a link on the thread's own site and moves the person to
-- Following up; the founder moves the status, only for their own people; the scan's reach check sets the level here
-- (HN never has DMs) and keeps at most one DM draft per DM-ready person, 20 a day; a nudge waits 4 days; answered
-- back only moves forward; founders cannot call the service-role saves.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(31);

insert into auth.users (id, email) values
  ('e3390000-0000-4000-8000-00000000000a', 'pr-a@test.local'),
  ('e3390000-0000-4000-8000-00000000000b', 'pr-b@test.local');
insert into public.cmo_runs (id, user_id, kind, status, input, credits) values
  ('e3390000-0000-4000-8000-0000000000a0', 'e3390000-0000-4000-8000-00000000000a', 'sales_scan', 'running', '{}', 0),
  ('e3390000-0000-4000-8000-0000000000b0', 'e3390000-0000-4000-8000-00000000000b', 'sales_scan', 'running', '{}', 0);
insert into public.opportunities (id, user_id, run_id, platform, url, community, title, score, reply) values
  ('e3390000-0000-4000-8000-0000000000c1', 'e3390000-0000-4000-8000-00000000000a', 'e3390000-0000-4000-8000-0000000000a0',
   'reddit', 'https://www.reddit.com/r/freelance/comments/c1/late_invoices/', 'freelance', 'Invoices', 80, 'Try a reminder.'),
  ('e3390000-0000-4000-8000-0000000000c2', 'e3390000-0000-4000-8000-00000000000a', 'e3390000-0000-4000-8000-0000000000a0',
   'hn', 'https://news.ycombinator.com/item?id=4242', '', 'Ask HN', 70, 'Reply.'),
  ('e3390000-0000-4000-8000-0000000000c3', 'e3390000-0000-4000-8000-00000000000a', 'e3390000-0000-4000-8000-0000000000a0',
   'facebook', 'https://www.facebook.com/groups/founders/posts/123/', 'founders', 'FB', 75, 'Reply.'),
  ('e3390000-0000-4000-8000-0000000000d1', 'e3390000-0000-4000-8000-00000000000b', 'e3390000-0000-4000-8000-0000000000b0',
   'reddit', 'https://www.reddit.com/r/freelance/comments/d1/x/', 'freelance', 'B', 80, 'Reply.');

-- Rights.
select ok(has_function_privilege('authenticated', 'public.opportunity_mark_replied(uuid, text)', 'execute'), 'founders mark replied');
select ok(has_function_privilege('authenticated', 'public.opportunity_set_status(uuid, text)', 'execute'), 'founders set a status');
select ok(not has_function_privilege('authenticated', 'public.cmo_save_reach(uuid, uuid, jsonb)', 'execute'), 'not the reach save');
select ok(not has_function_privilege('authenticated', 'public.cmo_save_nudge(uuid, uuid, uuid, text)', 'execute'), 'not the nudge save');
select ok(not has_function_privilege('authenticated', 'public.cmo_mark_answered_back(uuid, uuid)', 'execute'), 'not answered back');
select ok(not has_function_privilege('authenticated', 'public.reply_url_fits(text, text, text)', 'execute'), 'not the link check');
select ok(not has_function_privilege('anon', 'public.opportunity_mark_replied(uuid, text)', 'execute'), 'signed-out visitors cannot');

-- The reach check (service role).
select throws_ok($$ select public.cmo_save_reach('e3390000-0000-4000-8000-00000000000a', 'e3390000-0000-4000-8000-0000000000b0', '[]') $$,
  'P0002', 'Run not found.', 'another founder''s run is refused');
select is(public.cmo_save_reach('e3390000-0000-4000-8000-00000000000a', 'e3390000-0000-4000-8000-0000000000a0', $j$[
  {"url": "https://www.reddit.com/r/freelance/comments/c1/late_invoices/", "level": "reply_first",
   "reach": {"buyer": true, "wantsNow": true, "warm": true, "fresh": true, "dmAllowed": true, "asksForTools": false,
             "emailFound": "sam@studio.example", "reasons": ["Runs a two-person studio", " "]},
   "dm": "Saw your thread on late invoices. I make a tool for this, happy to share if useful."},
  {"url": "https://news.ycombinator.com/item?id=4242", "level": "dm_ready",
   "reach": {"buyer": true, "wantsNow": true, "warm": true, "fresh": true, "dmAllowed": true, "asksForTools": true, "emailFound": null, "reasons": []},
   "dm": "Should not be kept"},
  {"url": "https://www.facebook.com/groups/founders/posts/123/",
   "reach": {"buyer": "yes", "wantsNow": true, "warm": false, "fresh": true, "dmAllowed": true, "asksForTools": true, "emailFound": "not an email"}},
  {"url": "https://www.reddit.com/r/freelance/comments/d1/x/", "reach": {"buyer": true}}
]$j$), 3, 'three of the founder''s own conversations; another founder''s url is skipped');
select is((select reach_level from public.opportunities where id = 'e3390000-0000-4000-8000-0000000000c1'), 'email_ready',
  'the level is worked out from the checks, not taken from the item');
select is((select reach->'reasons' from public.opportunities where id = 'e3390000-0000-4000-8000-0000000000c1'),
  '["Runs a two-person studio"]'::jsonb, 'empty reasons are dropped');
select ok((select dm_draft is not null from public.opportunities where id = 'e3390000-0000-4000-8000-0000000000c1'), 'a DM-ready person gets the draft');
select is((select reach_level || ' / ' || (reach->>'dmAllowed') || ' / ' || coalesce(dm_draft, '-') from public.opportunities
  where id = 'e3390000-0000-4000-8000-0000000000c2'), 'reply_first / false / -', 'Hacker News has no DMs');
select is((select reach_level || ' / ' || coalesce(reach->>'emailFound', 'null') from public.opportunities
  where id = 'e3390000-0000-4000-8000-0000000000c3'), 'reply_first / null', 'a non-boolean check is false and a bad address is dropped');
select is((select reach from public.opportunities where id = 'e3390000-0000-4000-8000-0000000000d1'), '{}'::jsonb,
  'another founder''s conversation is untouched');

-- The daily DM cap.
update public.opportunities set dm_draft = null, dm_drafted_at = null where id = 'e3390000-0000-4000-8000-0000000000c1';
insert into public.opportunities (user_id, run_id, platform, url, community, title, score, reply, dm_draft, dm_drafted_at)
select 'e3390000-0000-4000-8000-00000000000a', 'e3390000-0000-4000-8000-0000000000a0', 'reddit',
  'https://www.reddit.com/r/cap/comments/' || g || '/x/', 'cap', 'Cap', 70, 'R', 'DM', now()
from generate_series(1, 20) g;
select is(public.cmo_save_reach('e3390000-0000-4000-8000-00000000000a', 'e3390000-0000-4000-8000-0000000000a0', $j$[
  {"url": "https://www.reddit.com/r/freelance/comments/c1/late_invoices/",
   "reach": {"buyer": true, "wantsNow": true, "warm": true, "fresh": true, "dmAllowed": true, "asksForTools": false, "emailFound": null}, "dm": "One more"}
]$j$), 1, 'the check is still saved at the cap');
select ok((select dm_draft is null from public.opportunities where id = 'e3390000-0000-4000-8000-0000000000c1'), 'but no 21st DM draft that day');

-- Founder A marks a reply.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3390000-0000-4000-8000-00000000000a"}';

select throws_ok($$ select public.opportunity_mark_replied('e3390000-0000-4000-8000-0000000000c1', 'https://www.reddit.com/r/other/comments/zz/x/') $$,
  '22023', 'Paste the link to your reply in this thread.', 'a link to another thread is refused');
select throws_ok($$ select public.opportunity_mark_replied('e3390000-0000-4000-8000-0000000000d1', 'https://www.reddit.com/r/freelance/comments/d1/x/abc/') $$,
  'P0002', 'Conversation not found.', 'another founder''s conversation is not found');
select throws_ok($$ select public.opportunity_set_status('e3390000-0000-4000-8000-0000000000c1', 'talking') $$,
  'P0001', 'Mark that you replied first.', 'no talking before a reply');
select is((select person_status || ' / ' || status from public.opportunity_mark_replied('e3390000-0000-4000-8000-0000000000c1',
  'https://www.reddit.com/r/freelance/comments/c1/late_invoices/kx1/')), 'replied / replied', 'the card and the person are replied');
select is((select outcome_url from public.cmo_draft_outcomes where item_id = 'e3390000-0000-4000-8000-0000000000c1'),
  'https://www.reddit.com/r/freelance/comments/c1/late_invoices/kx1/', 'the link is on the draft''s outcome');
select is((select reply_url from public.opportunity_mark_replied('e3390000-0000-4000-8000-0000000000c3',
  'https://www.facebook.com/groups/founders/posts/123/?comment_id=9')), 'https://www.facebook.com/groups/founders/posts/123/?comment_id=9',
  'a Facebook comment link in the same group');
select is((select person_status from public.opportunity_set_status('e3390000-0000-4000-8000-0000000000c1', 'talking')), 'talking',
  'the founder moves the person');
select throws_ok($$ select public.opportunity_set_status('e3390000-0000-4000-8000-0000000000c1', 'ghosted') $$,
  '22023', 'Unknown status.', 'an unknown status is refused');
select is((select person_status from public.opportunity_set_status('e3390000-0000-4000-8000-0000000000c2', 'not_interested')),
  'not_interested', 'not interested needs no reply');

reset role;

-- The card's own button moves the person too (the trigger).
update public.opportunities set status = 'replied', decided_at = now() where id = 'e3390000-0000-4000-8000-0000000000d1';
select is((select person_status from public.opportunities where id = 'e3390000-0000-4000-8000-0000000000d1'), 'replied',
  'marking the card replied moves the person to Following up');

-- Nudges after 4 days; answered back forward only.
select ok(not public.cmo_save_nudge('e3390000-0000-4000-8000-00000000000b', 'e3390000-0000-4000-8000-0000000000b0',
  'e3390000-0000-4000-8000-0000000000d1', 'Any luck with it?'), 'no nudge before 4 days');
update public.opportunities set replied_at = now() - interval '5 days' where id = 'e3390000-0000-4000-8000-0000000000d1';
select ok(public.cmo_save_nudge('e3390000-0000-4000-8000-00000000000b', 'e3390000-0000-4000-8000-0000000000b0',
  'e3390000-0000-4000-8000-0000000000d1', 'Any luck with it?'), 'a nudge after 4 days with no answer');
select ok(public.cmo_mark_answered_back('e3390000-0000-4000-8000-00000000000b', 'e3390000-0000-4000-8000-0000000000d1'),
  'answered back from replied');
select ok(not public.cmo_mark_answered_back('e3390000-0000-4000-8000-00000000000a', 'e3390000-0000-4000-8000-0000000000c1'),
  'never backwards from talking');

select * from finish();
rollback;
