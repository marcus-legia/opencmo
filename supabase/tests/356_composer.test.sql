-- 20270206010000: the Composer. The founder saves their own Reddit account ("u/" stripped, bad names refused, an
-- empty name clears it); compose_check is a 1-credit job, 30 a day; the rules cache keeps the full text.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(10);

insert into auth.users (id, email) values
  ('e3560000-0000-4000-8000-00000000000a', 'compose-a@test.local'),
  ('e3560000-0000-4000-8000-00000000000b', 'compose-b@test.local');

select is(public.cmo_job_price('compose_check'), 1, 'a check costs 1 credit');
select is(public.cmo_job_daily_limit('compose_check'), 30, 'at most 30 a day');
select ok(not has_function_privilege('anon', 'public.save_reddit_account(text, integer, date)', 'execute'), 'not for signed-out visitors');

insert into public.subreddit_rules (subreddit, verdict, summary, rules_text, submit_text, guide)
values ('saas', 'requires_disclosure', 'r/saas: disclose', '1 Be kind 2 SaaS only', 'Use a flair.', '{"avoid":["my tool"],"use":["a question"]}');
select is((select guide->'avoid'->>0 from public.subreddit_rules where subreddit = 'saas'), 'my tool', 'the guide is kept with the rules');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3560000-0000-4000-8000-00000000000a"}';

select is((select reddit_username || ' ' || reddit_karma || ' ' || reddit_created_at from public.save_reddit_account('u/My_Handle', 120, date '2025-03-17')),
  'My_Handle 120 2025-03-01', '"u/" is dropped and the date is its month');
select throws_ok($$ select public.save_reddit_account('has space') $$, '22023', 'Use your Reddit username, like my_handle.', 'a bad name is refused');
select throws_ok($$ select public.save_reddit_account('ok_name', -1) $$, '22023', 'Karma is a number from 0.', 'negative karma is refused');
select throws_ok($$ select public.save_reddit_account('ok_name', 1, current_date + 40) $$, '22023', 'Use the month your Reddit account was made.', 'a future date is refused');
select is((select coalesce(reddit_username, 'none') || ' ' || coalesce(reddit_karma::text, 'none') from public.save_reddit_account('')),
  'none none', 'an empty name clears the account');

reset role;
select is((select count(*)::integer from public.profiles where id = 'e3560000-0000-4000-8000-00000000000b' and reddit_username is not null), 0,
  'another founder''s row is untouched');

select * from finish();
rollback;
