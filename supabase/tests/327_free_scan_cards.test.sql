-- Free scan A3 (20270131010001): the account's free scan saves its cards with `reply = ''`; a paid scan still drops a
-- card with no draft; a skipped thread is kept without one either way.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

insert into auth.users (id, email) values
  ('e3270000-0000-4000-8000-00000000000a', 'fc-a@test.local'),
  ('e3270000-0000-4000-8000-00000000000b', 'fc-b@test.local');
insert into public.cmo_runs (id, user_id, kind, status, input, credits) values
  ('e3270000-0000-4000-8000-0000000000a1', 'e3270000-0000-4000-8000-00000000000a', 'sales_scan', 'running', '{}', 0),
  ('e3270000-0000-4000-8000-0000000000b1', 'e3270000-0000-4000-8000-00000000000b', 'sales_scan', 'running', '{}', 5);

select is(public.cmo_save_opportunities('e3270000-0000-4000-8000-00000000000a', 'e3270000-0000-4000-8000-0000000000a1', '[
  {"url":"https://www.reddit.com/r/freelance/comments/a1/late/","community":"freelance","title":"Clients pay late","score":80,"reply":"","rule":"no_product_mention"},
  {"url":"https://news.ycombinator.com/item?id=111","platform":"hn","community":"HN","title":"Invoices","score":70,"rule":"no_product_mention"},
  {"url":"https://www.reddit.com/r/nobiz/comments/a2/x/","community":"nobiz","title":"Skipped","score":75,"reply":"","rule":"skip"}
]'::jsonb), 3, 'the free scan keeps its undrafted cards and the skipped thread');
select is((select reply from public.opportunities where url = 'https://www.reddit.com/r/freelance/comments/a1/late/'), '',
  'an undrafted card has an empty reply');
select is((select reply from public.opportunities where url = 'https://news.ycombinator.com/item?id=111'), '',
  'a missing reply is saved empty');
select ok((select reply is null from public.opportunities where url = 'https://www.reddit.com/r/nobiz/comments/a2/x/'),
  'a skipped thread has no reply');

select is(public.cmo_save_opportunities('e3270000-0000-4000-8000-00000000000b', 'e3270000-0000-4000-8000-0000000000b1', '[
  {"url":"https://www.reddit.com/r/freelance/comments/b1/late/","community":"freelance","title":"No draft","score":80,"reply":"","rule":"no_product_mention"},
  {"url":"https://www.reddit.com/r/freelance/comments/b2/late/","community":"freelance","title":"Drafted","score":80,"reply":"Send the reminder on day 3.","rule":"no_product_mention"}
]'::jsonb), 1, 'a paid scan drops a card with no draft');
-- A run of another account priced 0 does not make this account's save free.
select is(public.cmo_save_opportunities('e3270000-0000-4000-8000-00000000000b', 'e3270000-0000-4000-8000-0000000000a1', '[
  {"url":"https://www.reddit.com/r/freelance/comments/b3/late/","community":"freelance","title":"Other run","score":80,"reply":"","rule":"no_product_mention"}
]'::jsonb), 0, 'only the account''s own free run keeps undrafted cards');
select throws_ok($$ update public.opportunities set reply = repeat('a', 3001) where url = 'https://www.reddit.com/r/freelance/comments/a1/late/' $$,
  '23514', null, 'a reply is still at most 3000 characters');

select * from finish();
rollback;
