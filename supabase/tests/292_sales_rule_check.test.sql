-- 5.1 (20270115030000): a subreddit's rules in four states plus skip, the old values moved to the new ones, and the
-- karma and account-age requirement carried from the scan to the reply card.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email) values ('e2920000-0000-4000-8000-00000000000a', 'rules292@test.local');

-- Rows stored before the change.
insert into public.subreddit_rules (subreddit, verdict, summary) values
  ('saas292', 'mention_ok', 'r/saas292 allows it'), ('freelance292', 'help_only', 'r/freelance292 forbids self-promotion'),
  ('memes292', 'skip', 'r/memes292: no business talk');
insert into public.opportunities (user_id, url, community, title, score, reply, rule, status) values
  ('e2920000-0000-4000-8000-00000000000a', 'https://www.reddit.com/r/saas292/comments/b1/', 'r/saas292', 'Tools?', 70, 'A reply', 'mention_ok', 'in_review'),
  ('e2920000-0000-4000-8000-00000000000a', 'https://www.reddit.com/r/freelance292/comments/b2/', 'r/freelance292', 'Late', 70, 'A reply', 'help_only', 'in_review');

select is(public.sales_rules_backfill(), 4, 'the backfill moves every old row');
select is((select string_agg(subreddit || '=' || verdict, ',' order by subreddit) from public.subreddit_rules where subreddit like '%292'),
  'freelance292=no_product_mention,memes292=skip,saas292=safe', 'mention_ok → safe, help_only → no_product_mention, skip stays');
select is((select string_agg(rule, ',' order by url) from public.opportunities where user_id = 'e2920000-0000-4000-8000-00000000000a'),
  'no_product_mention,safe', 'the threads too');
select is(public.sales_rules_backfill(), 0, 'a second run changes nothing');
select ok(not has_function_privilege('authenticated', 'public.sales_rules_backfill()', 'execute'), 'only the service role runs it');

select throws_ok($$ insert into public.subreddit_rules (subreddit, verdict) values ('bad292', 'maybe') $$, '23514', null, 'an unknown state is refused');
select throws_ok($$ update public.subreddit_rules set min_karma = -1 where subreddit = 'saas292' $$, '23514', null, 'a karma floor is not negative');

-- The scan saves the new states with the requirement; an old value from a replay is mapped.
select is(public.cmo_save_opportunities('e2920000-0000-4000-8000-00000000000a', null, jsonb_build_array(
  jsonb_build_object('url', 'https://www.reddit.com/r/saas292/comments/c1/', 'community', 'r/saas292', 'title', 'Which tool?', 'score', 80,
    'reply', 'I make Paylane, so I am biased.', 'rule', 'requires_disclosure', 'rule_why', 'r/saas292: say you made it',
    'min_karma', 50, 'min_account_age_days', 30),
  jsonb_build_object('url', 'https://www.reddit.com/r/new292/comments/c2/', 'community', 'r/new292', 'title', 'Help', 'score', 75,
    'reply', 'Send the reminder on day 3.', 'rule', 'not_verified', 'rule_why', 'rules not read'),
  jsonb_build_object('url', 'https://www.reddit.com/r/old292/comments/c3/', 'community', 'r/old292', 'title', 'Old', 'score', 75,
    'reply', 'Help.', 'rule', 'help_only', 'min_karma', 'lots'))), 3, 'three threads saved');
select is((select rule || ' ' || min_karma || ' ' || min_account_age_days from public.opportunities where url like '%/c1/'),
  'requires_disclosure 50 30', 'the state and the requirement are kept');
select is((select rule || ' ' || coalesce(min_karma::text, 'none') from public.opportunities where url like '%/c3/'),
  'no_product_mention none', 'an old value is mapped and a karma that is not a number is dropped');

select is((select snapshot->>'min_karma' || '/' || (snapshot->>'min_account_age_days') from public.approvals
  where ref_kind = 'opportunity' and ref_id = (select id from public.opportunities where url like '%/c1/')),
  '50/30', 'the reply card carries the requirement');
select ok((select not (snapshot ? 'min_karma') from public.approvals
  where ref_kind = 'opportunity' and ref_id = (select id from public.opportunities where url like '%/c2/')),
  'and no requirement when the rules state none');

select * from finish();
rollback;
