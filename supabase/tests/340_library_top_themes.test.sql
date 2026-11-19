-- Wave 3 (20270201030000): the service-role read of a founder's top Library themes for the week plan: only recent
-- entries count, most entries first, five newest entries each, only that founder's; founders cannot call it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(6);

insert into auth.users (id, email) values
  ('e3400000-0000-4000-8000-00000000000a', 'top-a@test.local'),
  ('e3400000-0000-4000-8000-00000000000b', 'top-b@test.local');
insert into public.library_themes (id, user_id, name) values
  ('e3400000-0000-4000-8000-0000000000f1', 'e3400000-0000-4000-8000-00000000000a', 'Late invoices'),
  ('e3400000-0000-4000-8000-0000000000f2', 'e3400000-0000-4000-8000-00000000000a', 'Onboarding'),
  ('e3400000-0000-4000-8000-0000000000f3', 'e3400000-0000-4000-8000-00000000000a', 'Old news'),
  ('e3400000-0000-4000-8000-0000000000f9', 'e3400000-0000-4000-8000-00000000000b', 'Other founder');
insert into public.opportunities (id, user_id, platform, url, community, title, score, reply, posted_at)
select ('e3400000-0000-4000-8000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'e3400000-0000-4000-8000-00000000000a', 'reddit',
  'https://www.reddit.com/r/x/comments/' || g || '/x/', 'x', 'T', 70, '',
  case when g = 9 then now() - interval '30 days' else now() - make_interval(hours => g) end
from generate_series(1, 9) g;
insert into public.opportunities (id, user_id, platform, url, community, title, score, reply, posted_at) values
  ('e3400000-0000-4000-8000-000000000199', 'e3400000-0000-4000-8000-00000000000b', 'reddit',
   'https://www.reddit.com/r/x/comments/99/x/', 'x', 'T', 70, '', now());
-- Six invoice entries (1–6), two onboarding (7–8), one old (9); B has one.
insert into public.library_entries (opportunity_id, user_id, theme_id, summary, platform, community, posted_at)
select o.id, o.user_id,
  case when n <= 6 then 'e3400000-0000-4000-8000-0000000000f1'::uuid when n <= 8 then 'e3400000-0000-4000-8000-0000000000f2'::uuid
       else 'e3400000-0000-4000-8000-0000000000f3'::uuid end,
  'Line ' || n, 'reddit', 'x', o.posted_at
from (select o.*, right(o.id::text, 2)::integer n from public.opportunities o where o.user_id = 'e3400000-0000-4000-8000-00000000000a') o;
insert into public.library_entries (opportunity_id, user_id, theme_id, summary, platform, community, posted_at) values
  ('e3400000-0000-4000-8000-000000000199', 'e3400000-0000-4000-8000-00000000000b', 'e3400000-0000-4000-8000-0000000000f9', 'B', 'reddit', 'x', now());

select ok(not has_function_privilege('authenticated', 'public.cmo_library_top_themes(uuid, integer, integer)', 'execute'),
  'founders cannot call it');
select is((select string_agg(t->>'name' || ':' || (t->>'count'), ', ')
  from jsonb_array_elements(public.cmo_library_top_themes('e3400000-0000-4000-8000-00000000000a')) t),
  'Late invoices:6, Onboarding:2', 'recent themes, most entries first; an old one and another founder''s are left out');
select is((select jsonb_array_length(t->'entries') from jsonb_array_elements(public.cmo_library_top_themes('e3400000-0000-4000-8000-00000000000a')) t
  where t->>'name' = 'Late invoices'), 5, 'five entries per theme');
select is((select t->'entries'->0->>'summary' from jsonb_array_elements(public.cmo_library_top_themes('e3400000-0000-4000-8000-00000000000a')) t
  where t->>'name' = 'Late invoices'), 'Line 1', 'newest first');
select is(jsonb_array_length(public.cmo_library_top_themes('e3400000-0000-4000-8000-00000000000a', 14, 1)), 1, 'the limit holds');
select is(jsonb_array_length(public.cmo_library_top_themes('e3400000-0000-4000-8000-00000000000a', 60)), 3, 'a longer window takes the old theme');

select * from finish();
rollback;
