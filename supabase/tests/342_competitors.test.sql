-- Wave 3 A6 (20270201050000): competitors by URL. The site is normalised to its host and kept once per founder, a
-- re-add refreshes it, a bad or private address is refused, at most 20; founders read and remove only their own; the
-- mentions view counts whole-word names in their own Sales conversations, per week.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(15);

insert into auth.users (id, email) values
  ('e3420000-0000-4000-8000-00000000000a', 'cmp-a@test.local'),
  ('e3420000-0000-4000-8000-00000000000b', 'cmp-b@test.local');
insert into public.opportunities (user_id, platform, url, community, title, snippet, score, reply, created_at) values
  ('e3420000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/1/x/', 'a', 'Moved off InvoiceNinja', 'it was slow', 70, '', now()),
  ('e3420000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/2/x/', 'a', 'Tools?', 'Tried invoiceninja and FreshBooks', 70, '', now()),
  ('e3420000-0000-4000-8000-00000000000a', 'reddit', 'https://www.reddit.com/r/a/comments/3/x/', 'a', 'Ninjas', 'InvoiceNinjas fan club', 70, '', now()),
  ('e3420000-0000-4000-8000-00000000000b', 'reddit', 'https://www.reddit.com/r/b/comments/1/x/', 'b', 'InvoiceNinja', '', 70, '', now());

select ok(not has_function_privilege('anon', 'public.competitor_add(text, text, text, text, text, text)', 'execute'), 'signed-out visitors cannot add');
select ok(not has_table_privilege('authenticated', 'public.competitors', 'insert'), 'writes go through the RPC');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3420000-0000-4000-8000-00000000000a"}';

select is((select site || ' / ' || name from public.competitor_add('https://www.InvoiceNinja.com/pricing?x=1', 'Invoice Ninja',
  'https://invoiceninja.com/logo.png', '$10 a month', 'Invoices and payments')), 'invoiceninja.com / Invoice Ninja', 'host kept, www and path dropped');
select is((select name || ' / ' || price from public.competitor_add('invoiceninja.com', null, null, '$12 a month')),
  'Invoice Ninja / $12 a month', 'a re-add refreshes what it brings and keeps the rest');
select is((select count(*)::integer from public.competitors), 1, 'one competitor per site');
select is((select name from public.competitor_add('freshbooks.com')), 'freshbooks.com', 'no name read: the site is the name');
select is((select logo_url from public.competitor_add('wave.com', 'Wave', 'http://wave.com/logo.png')), null, 'a logo not on https is dropped');
select throws_ok($$ select public.competitor_add('localhost') $$, '22023', 'Paste the competitor''s website, like example.com.', 'no local hosts');
select throws_ok($$ select public.competitor_add('https://10.0.0.1/') $$, '22023', 'Paste the competitor''s website, like example.com.', 'no IP addresses');
select throws_ok($$ select public.competitor_add('example.com', null, null, null, null, 'robot') $$, '22023', 'Unknown source.', 'url or chat only');

reset role;
update public.competitors set name = 'InvoiceNinja' where site = 'invoiceninja.com';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3420000-0000-4000-8000-00000000000a"}';
select is((select string_agg(name || ':' || mentions, ', ' order by name) from public.my_competitor_mentions),
  'InvoiceNinja:2', 'whole-word mentions in the founder''s own conversations, this week');

reset role;
insert into public.competitors (user_id, site, name)
select 'e3420000-0000-4000-8000-00000000000a', 'c' || g || '.example.com', 'C' || g from generate_series(1, 17) g;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3420000-0000-4000-8000-00000000000a"}';
select throws_ok($$ select public.competitor_add('one-too-many.com') $$, 'P0001', 'Keep at most 20 competitors.', 'at most 20');

set local request.jwt.claims = '{"sub":"e3420000-0000-4000-8000-00000000000b"}';
select is((select count(*)::integer from public.competitors), 0, 'another founder reads none of them');
select ok(not public.competitor_remove((select id from public.competitors limit 1)), 'and removes none');
set local request.jwt.claims = '{"sub":"e3420000-0000-4000-8000-00000000000a"}';
select ok(public.competitor_remove((select id from public.competitors where site = 'wave.com')), 'the founder removes their own');

select * from finish();
rollback;
