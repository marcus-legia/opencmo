-- Wave 3 A2 (20270201010000): the Library. A founder's own scan saves summary lines and quotes under themes; another
-- founder's run, or a conversation that is not theirs, saves nothing; my_library counts per theme, the last 7 days and
-- the posts written from it; a removal request drops the line for everyone; founders read only their own rows.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(22);

insert into auth.users (id, email) values
  ('e3380000-0000-4000-8000-00000000000a', 'lib-a@test.local'),
  ('e3380000-0000-4000-8000-00000000000b', 'lib-b@test.local');
insert into public.cmo_runs (id, user_id, kind, status, input, credits) values
  ('e3380000-0000-4000-8000-0000000000a0', 'e3380000-0000-4000-8000-00000000000a', 'sales_scan', 'running', '{}', 0),
  ('e3380000-0000-4000-8000-0000000000a1', 'e3380000-0000-4000-8000-00000000000a', 'plan_week', 'running', '{}', 0),
  ('e3380000-0000-4000-8000-0000000000b0', 'e3380000-0000-4000-8000-00000000000b', 'sales_scan', 'running', '{}', 0);
insert into public.opportunities (id, user_id, run_id, platform, url, community, title, score, reply, posted_at) values
  ('e3380000-0000-4000-8000-0000000000c1', 'e3380000-0000-4000-8000-00000000000a', 'e3380000-0000-4000-8000-0000000000a0',
   'reddit', 'https://www.reddit.com/r/freelance/comments/c1/x/', 'freelance', 'Invoices', 80, '', now() - interval '1 day'),
  ('e3380000-0000-4000-8000-0000000000c2', 'e3380000-0000-4000-8000-00000000000a', 'e3380000-0000-4000-8000-0000000000a0',
   'hn', 'https://news.ycombinator.com/item?id=4242', '', 'Ask HN: invoices', 70, '', now() - interval '2 days'),
  ('e3380000-0000-4000-8000-0000000000c3', 'e3380000-0000-4000-8000-00000000000a', 'e3380000-0000-4000-8000-0000000000a0',
   'reddit', 'https://www.reddit.com/r/smallbusiness/comments/c3/x/', 'smallbusiness', 'Onboarding', 75, '', null),
  ('e3380000-0000-4000-8000-0000000000d1', 'e3380000-0000-4000-8000-00000000000b', 'e3380000-0000-4000-8000-0000000000b0',
   'reddit', 'https://www.reddit.com/r/freelance/comments/c1/x/', 'freelance', 'Invoices', 80, '', null);

-- Rights.
select ok(not has_function_privilege('authenticated', 'public.cmo_save_library(uuid, uuid, jsonb)', 'execute'),
  'founders cannot call the scan''s save');
select ok(not has_function_privilege('authenticated', 'public.library_delete_entry(text)', 'execute'),
  'founders cannot call the removal');
select ok(has_function_privilege('authenticated', 'public.my_library(text)', 'execute'), 'founders read their Library');
select ok(not has_function_privilege('anon', 'public.my_library(text)', 'execute'), 'signed-out visitors do not');

-- Ownership of the run.
select throws_ok($$ select public.cmo_save_library('e3380000-0000-4000-8000-00000000000a',
  'e3380000-0000-4000-8000-0000000000b0', '[]') $$, 'P0002', 'Run not found.', 'another founder''s run is refused');
select throws_ok($$ select public.cmo_save_library('e3380000-0000-4000-8000-00000000000a',
  'e3380000-0000-4000-8000-0000000000a1', '[]') $$, 'P0002', 'Run not found.', 'a run that is not a scan is refused');
select throws_ok($$ select public.cmo_save_library('e3380000-0000-4000-8000-00000000000a',
  'e3380000-0000-4000-8000-0000000000a0', '{}') $$, '22023', 'These Library entries are not valid.', 'items must be a list');

select is(public.cmo_save_library('e3380000-0000-4000-8000-00000000000a', 'e3380000-0000-4000-8000-0000000000a0', $j$[
  {"url": "https://www.reddit.com/r/freelance/comments/c1/x/", "theme": "Chasing late invoices", "summary": "Chases three clients a month by hand",
   "quotes": [{"kind": "pain", "text": "I spend Fridays chasing invoices"}, {"kind": "bio", "text": "dropped"}, {"kind": "evidence", "text": "  "}]},
  {"url": "https://news.ycombinator.com/item?id=4242", "theme": "chasing  LATE invoices", "summary": "Wants reminders that sound human",
   "quotes": [{"kind": "evidence", "text": "Looking for a tool this week"}]},
  {"url": "https://www.reddit.com/r/smallbusiness/comments/c3/x/", "theme": "Client onboarding", "summary": "Loses a day per new client"},
  {"url": "https://www.reddit.com/r/elsewhere/comments/zz/x/", "theme": "Nope", "summary": "Not one of the founder's conversations"},
  {"url": "https://www.reddit.com/r/smallbusiness/comments/c3/x/", "theme": "Client onboarding", "summary": ""}
]$j$), 3, 'three lines saved; an unknown conversation and an empty summary are skipped');

select is((select count(*)::integer from public.library_themes where user_id = 'e3380000-0000-4000-8000-00000000000a'), 2,
  'the same theme in another case is one theme');
select is((select quotes from public.library_entries where opportunity_id = 'e3380000-0000-4000-8000-0000000000c1'),
  '[{"kind": "pain", "text": "I spend Fridays chasing invoices"}]'::jsonb, 'only pain and evidence quotes with text are kept');
select is((select platform || ' / ' || community from public.library_entries where opportunity_id = 'e3380000-0000-4000-8000-0000000000c1'),
  'reddit / freelance', 'source and community come from the conversation, not the item');

-- A later scan updates the line rather than adding one.
select is(public.cmo_save_library('e3380000-0000-4000-8000-00000000000a', 'e3380000-0000-4000-8000-0000000000a0', $j$[
  {"url": "https://www.reddit.com/r/freelance/comments/c1/x/", "theme": "Chasing late invoices", "summary": "Chases four clients a month by hand"}
]$j$), 1, 'a second save of the same conversation');
select is((select count(*)::integer from public.library_entries where user_id = 'e3380000-0000-4000-8000-00000000000a'), 3,
  'it updated the line');

-- Founder B's own conversation with the same url is untouched by A's save.
select is((select count(*)::integer from public.library_entries where user_id = 'e3380000-0000-4000-8000-00000000000b'), 0,
  'another founder''s conversation got no line');

-- The weekly trend: one invoice line is older than 7 days.
update public.library_entries set created_at = now() - interval '10 days'
where opportunity_id = 'e3380000-0000-4000-8000-0000000000c2';
-- A post written from the first invoice conversation.
insert into public.content_items (user_id, department, platform, day, idea, body) values
  ('e3380000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Invoices',
   '{"sources": [{"opportunityId": "e3380000-0000-4000-8000-0000000000c1", "summary": "Chases", "platform": "reddit", "community": "freelance"}]}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3380000-0000-4000-8000-00000000000a"}';

select is((select string_agg(name || ':' || count || ':' || this_week || ':' || used_in_posts, ', ') from public.my_library()),
  'Chasing late invoices:2:1:1, Client onboarding:1:1:0', 'counts, the last 7 days and posts per theme, most quoted first');
select is((select jsonb_array_length(entries) from public.my_library() where name = 'Chasing late invoices'), 2,
  'each theme carries its entries');
select is((select entries->0->>'summary' from public.my_library() where name = 'Chasing late invoices'),
  'Chases four clients a month by hand', 'newest post first');
select is((select string_agg(name || ':' || count, ', ') from public.my_library('hn')), 'Chasing late invoices:1',
  'filtered by source');
select is((select count(*)::integer from public.library_entries), 3, 'RLS: a founder reads only their own lines');

reset role;
select ok(not has_function_privilege('authenticated', 'public.cmo_library_theme_names(uuid, integer)', 'execute'),
  'founders cannot call the theme list');
select is(array(select public.cmo_library_theme_names('e3380000-0000-4000-8000-00000000000a')),
  array['Chasing late invoices', 'Client onboarding'], 'theme names, most used first');
select is(public.library_delete_entry('https://www.reddit.com/r/freelance/comments/c1/x/'), 1,
  'a removal request drops the line kept from that link');

select * from finish();
rollback;
