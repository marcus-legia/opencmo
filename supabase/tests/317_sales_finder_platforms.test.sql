-- Sales finder A2 (docs/plans/cmo/2026-11-14-sales-finder-plan.md): Facebook group and Threads conversations are saved
-- like Reddit's, and the founder's Sales settings say where Sales may look (at least one place, from a fixed list).
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(15);

insert into auth.users (id, email) values
  ('e3170000-0000-4000-8000-00000000000a', 'sales-finder-a@example.com'),
  ('e3170000-0000-4000-8000-00000000000b', 'sales-finder-b@example.com');

-- Saving (service side, as the scan does).
select is(public.cmo_save_opportunities('e3170000-0000-4000-8000-00000000000a', null, jsonb_build_array(
  jsonb_build_object('platform', 'facebook', 'url', 'https://www.facebook.com/groups/1/posts/2/', 'title', 'Need help with invoices',
    'community', 'Freelancers', 'score', 72, 'reply', 'Put the due date on the invoice.', 'rule', 'no_product_mention'),
  jsonb_build_object('platform', 'threads', 'url', 'https://www.threads.com/@a/post/XYZ', 'title', 'Chasing clients again',
    'community', 'Threads', 'score', 66, 'reply', 'A day-3 reminder helps.', 'rule', 'no_product_mention'))), 2,
  'a Facebook and a Threads conversation are saved');
select results_eq($$ select platform from public.opportunities where user_id = 'e3170000-0000-4000-8000-00000000000a' order by platform $$,
  array['facebook', 'threads'], 'each keeps its platform');
select throws_ok($$ select public.cmo_save_opportunities('e3170000-0000-4000-8000-00000000000a', null, jsonb_build_array(
  jsonb_build_object('platform', 'x', 'url', 'https://x.com/a/status/1', 'title', 't', 'score', 70, 'reply', 'r'))) $$,
  '22023', 'A conversation comes from Reddit, Hacker News, a Facebook group or Threads.', 'X is not a Sales platform yet');
select throws_ok($$ insert into public.opportunities (user_id, platform, url, title, score, reply)
  values ('e3170000-0000-4000-8000-00000000000a', 'linkedin', 'https://www.linkedin.com/posts/1', 't', 70, 'r') $$,
  '23514', null, 'the table refuses an unknown platform too');

select throws_ok($$ insert into public.opportunities (user_id, platform, url, title, score, reply)
  values ('e3170000-0000-4000-8000-00000000000a', 'facebook', 'https://www.facebook.com/groups/1/', 't', 70, 'r') $$,
  '23514', null, 'a group''s home page is not a conversation');

-- Settings, as the founder.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3170000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((public.sales_settings_save('{}', '[]')).platforms, array['reddit', 'hn', 'facebook', 'threads'],
  'a new row looks everywhere');
select is((public.sales_settings_save(p_excluded => array['saas'], p_pairs => '[]')).platforms, array['reddit', 'hn', 'facebook', 'threads'],
  'the two-argument call still works and keeps the platforms');
select is((public.sales_settings_save('{}', '[]', array['threads', 'Reddit', 'threads'])).platforms, array['reddit', 'threads'],
  'platforms are lower-cased, de-duplicated, in the list order');
select is((public.sales_settings_save(array['saas'], '[]', null)).platforms, array['reddit', 'threads'],
  'null keeps the platforms already saved');
select is((select excluded_subreddits from public.sales_settings), array['saas'], 'and the rest is still saved');
select throws_ok($$ select public.sales_settings_save('{}', '[]', '{}') $$, '22023', 'Keep at least one place for Sales to look.',
  'Sales always has somewhere to look');
select throws_ok($$ select public.sales_settings_save('{}', '[]', array['x']) $$, '22023',
  'Sales can look on Reddit, Hacker News, Facebook groups and Threads.', 'an unknown platform is refused');

-- Another founder sees and changes only their own row.
set local request.jwt.claims = '{"sub":"e3170000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((public.sales_settings_save('{}', '[]', array['hn'])).platforms, array['hn'], 'b saves their own');
select is((select count(*)::integer from public.sales_settings), 1, 'b reads only their own row');
reset role;
select is((select platforms from public.sales_settings where user_id = 'e3170000-0000-4000-8000-00000000000a'),
  array['reddit', 'threads'], 'a''s platforms are untouched');

select * from finish();
rollback;
