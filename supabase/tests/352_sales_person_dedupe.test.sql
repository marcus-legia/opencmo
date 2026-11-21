-- Sales person dedupe (20270204010000): a scan never saves a card for an author the founder already has a card for
-- (open, replied, DM'd or emailed, not interested, or dismissed), on the same platform, whatever the case; an empty or
-- deleted author is never deduped; two threads of one author in one save keep the first; another founder's cards and
-- another platform's handle do not count. `cmo_seen_authors` lists the same keys, for the service role only.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

insert into auth.users (id, email) values
  ('e3520000-0000-4000-8000-00000000000a', 'pd-a@test.local'),
  ('e3520000-0000-4000-8000-00000000000b', 'pd-b@test.local');
insert into public.cmo_runs (id, user_id, kind, status, input, credits) values
  ('e3520000-0000-4000-8000-0000000000a1', 'e3520000-0000-4000-8000-00000000000a', 'sales_scan', 'running', '{}', 5),
  ('e3520000-0000-4000-8000-0000000000b1', 'e3520000-0000-4000-8000-00000000000b', 'sales_scan', 'running', '{}', 5);

-- The founder's earlier people, one in each state that must stop a new card.
insert into public.opportunities (user_id, platform, url, title, author, score, reply, status, person_status, contacted_via) values
  ('e3520000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/open/x/', 'Open card', 'u/OpenOne', 80, 'r', 'in_review', 'found', null),
  ('e3520000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/replied/x/', 'Replied', 'u/replied_one', 80, 'r', 'replied', 'replied', null),
  ('e3520000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/dm/x/', 'DM sent', 'u/dm_one', 80, 'r', 'replied', 'replied', 'dm'),
  ('e3520000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/no/x/', 'Said no', 'u/no_one', 80, 'r', 'replied', 'not_interested', 'email'),
  ('e3520000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/fit/x/', 'Not a fit', 'u/not_a_fit', 80, 'r', 'dismissed', 'found', null),
  ('e3520000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/del/x/', 'Deleted', 'u/[deleted]', 80, 'r', 'in_review', 'found', null),
  ('e3520000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/anon/x/', 'No author', '', 80, 'r', 'in_review', 'found', null);

select is(public.cmo_save_opportunities('e3520000-0000-4000-8000-00000000000a', 'e3520000-0000-4000-8000-0000000000a1', '[
  {"url":"https://www.reddit.com/r/b/comments/n1/x/","title":"Open again","author":"u/openone","score":80,"reply":"r","rule":"no_product_mention"},
  {"url":"https://www.reddit.com/r/b/comments/n2/x/","title":"Replied again","author":" u/Replied_One ","score":80,"reply":"r","rule":"no_product_mention"},
  {"url":"https://www.reddit.com/r/b/comments/n3/x/","title":"DM again","author":"u/dm_one","score":80,"reply":"r","rule":"no_product_mention"},
  {"url":"https://www.reddit.com/r/b/comments/n4/x/","title":"No again","author":"u/NO_ONE","score":80,"reply":"r","rule":"no_product_mention"},
  {"url":"https://www.reddit.com/r/b/comments/n5/x/","title":"Not a fit again","author":"u/not_a_fit","score":80,"reply":"r","rule":"skip"}
]'::jsonb), 0, 'no new card for anyone already met: open, replied, DM''d, not interested, dismissed (any case)');
select is((select count(*)::integer from public.opportunities where user_id = 'e3520000-0000-4000-8000-00000000000a'), 7,
  'nothing was inserted');

select is(public.cmo_save_opportunities('e3520000-0000-4000-8000-00000000000a', 'e3520000-0000-4000-8000-0000000000a1', '[
  {"url":"https://www.reddit.com/r/b/comments/d1/x/","title":"Deleted again","author":"u/[deleted]","score":80,"reply":"r","rule":"no_product_mention"},
  {"url":"https://www.reddit.com/r/b/comments/e1/x/","title":"Empty again","author":"","score":80,"reply":"r","rule":"no_product_mention"},
  {"url":"https://www.reddit.com/r/b/comments/e2/x/","title":"Missing author","score":80,"reply":"r","rule":"no_product_mention"}
]'::jsonb), 3, 'an empty or deleted author is never deduped');

select is(public.cmo_save_opportunities('e3520000-0000-4000-8000-00000000000a', 'e3520000-0000-4000-8000-0000000000a1', '[
  {"url":"https://www.reddit.com/r/b/comments/t1/x/","title":"First of two","author":"u/twice","score":80,"reply":"r","rule":"no_product_mention"},
  {"url":"https://www.reddit.com/r/c/comments/t2/x/","title":"Second of two","author":"u/Twice","score":90,"reply":"r","rule":"no_product_mention"}
]'::jsonb), 1, 'two threads of one author in one save: one card');
select is((select title from public.opportunities where author ilike 'u/twice'), 'First of two', 'the first one is kept');

-- The same handle on another platform is another person.
select is(public.cmo_save_opportunities('e3520000-0000-4000-8000-00000000000a', 'e3520000-0000-4000-8000-0000000000a1', '[
  {"url":"https://www.threads.com/@openone/post/C1","platform":"threads","title":"On Threads","author":"u/openone","score":80,"reply":"r","rule":"no_product_mention"}
]'::jsonb), 1, 'the same handle on another platform is not deduped');

-- Another founder's cards do not stop this founder's.
select is(public.cmo_save_opportunities('e3520000-0000-4000-8000-00000000000b', 'e3520000-0000-4000-8000-0000000000b1', '[
  {"url":"https://www.reddit.com/r/b/comments/n1/x/","title":"Open for b","author":"u/openone","score":80,"reply":"r","rule":"no_product_mention"}
]'::jsonb), 1, 'another founder may still reach the same person');

-- A new person still gets a card.
select is(public.cmo_save_opportunities('e3520000-0000-4000-8000-00000000000a', 'e3520000-0000-4000-8000-0000000000a1', '[
  {"url":"https://www.reddit.com/r/b/comments/new/x/","title":"Someone new","author":"u/someone_new","score":80,"reply":"r","rule":"no_product_mention"}
]'::jsonb), 1, 'a new person gets a card');

-- The scan's list: one key per person, lower-cased, without the authors that are never deduped.
select is((select count(*)::integer from public.cmo_seen_authors('e3520000-0000-4000-8000-00000000000a') a where a.author in ('u/openone', 'u/replied_one', 'u/not_a_fit', 'u/twice')), 4,
  'cmo_seen_authors lists the people already met, lower-cased');
select is((select count(*)::integer from public.cmo_seen_authors('e3520000-0000-4000-8000-00000000000a') a where a.author in ('', 'u/[deleted]')), 0,
  'and never an empty or deleted author');
select is((select count(*)::integer from public.cmo_seen_authors('e3520000-0000-4000-8000-00000000000a') a where a.platform = 'threads' and a.author = 'u/openone'), 1,
  'keyed by platform');
select ok(not has_function_privilege('authenticated', 'public.cmo_seen_authors(uuid)', 'execute'),
  'signed-in users cannot call cmo_seen_authors');
select ok(not has_function_privilege('authenticated', 'public.cmo_save_opportunities(uuid, uuid, jsonb)', 'execute'),
  'nor cmo_save_opportunities');

select * from finish();
rollback;
