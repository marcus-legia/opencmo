-- Launch measurement (20270204020000): a new founder keeps their first touch once (only known keys, cleaned; not on an
-- old account; not twice); heard_from takes the launch channels; deleting an account leaves one anonymous outcome row
-- (no user id), once even when the purge runs again; the owner's funnel counts the free scan and reads by channel.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email, created_at) values
  ('e3530000-0000-4000-8000-00000000000a', 'ft-new@test.local', now()),
  ('e3530000-0000-4000-8000-00000000000b', 'ft-old@test.local', now() - interval '40 days'),
  ('e3530000-0000-4000-8000-00000000000c', 'ft-owner@test.local', now());
insert into public.app_owners (email) values ('ft-owner@test.local') on conflict do nothing;

create function pg_temp.as_user(p_user uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
end $$;

select pg_temp.as_user('e3530000-0000-4000-8000-00000000000a', 'ft-new@test.local');
set local role authenticated;
select is(public.profile_set_first_touch('{"ref":"ph","utm_source":"producthunt","evil":"x","referrer_host":"bad host!"}'::jsonb), true, 'a new founder keeps a first touch');
select is(public.profile_set_first_touch('{"ref":"hn"}'::jsonb), false, 'only once');
reset role;
select is((select first_touch from public.profiles where id = 'e3530000-0000-4000-8000-00000000000a'),
  '{"ref":"ph","utm_source":"producthunt"}'::jsonb, 'only known keys with clean values are kept');
select is(public.first_touch_channel('{"ref":"ph"}'::jsonb), 'ph', 'the channel is the ref');
select is(public.first_touch_channel(null), 'direct', 'no first touch is direct');

select pg_temp.as_user('e3530000-0000-4000-8000-00000000000b', 'ft-old@test.local');
set local role authenticated;
select is(public.profile_set_first_touch('{"ref":"ph"}'::jsonb), false, 'an account older than a day keeps none');
reset role;

select lives_ok($$ update public.profiles set heard_from = 'product_hunt' where id = 'e3530000-0000-4000-8000-00000000000a' $$, 'heard_from takes Product Hunt');

-- The old free account has run its free scan and found one person; the purge picks it (retention ran out).
update public.profiles set retention_from = now() - interval '40 days', heard_from = 'hacker_news', first_touch = '{"ref":"hn"}'
where id = 'e3530000-0000-4000-8000-00000000000b';
insert into public.cmo_runs (user_id, kind, status, credits, output) values
  ('e3530000-0000-4000-8000-00000000000b', 'sales_scan', 'done', 0, '{"free":true}');
insert into public.opportunities (user_id, platform, url, title, score) values
  ('e3530000-0000-4000-8000-00000000000b', 'reddit', 'https://www.reddit.com/r/a/comments/ft1/x/', 'A person', 80);

select ok('e3530000-0000-4000-8000-00000000000b' in (select public.purge_unpaid_accounts(50)), 'the purge picks the expired free account');
select is((select count(*)::integer from public.signup_outcomes where channel = 'hn' and heard_from = 'hacker_news' and free_scan and people_found = 1 and not paid and deleted_as = 'unpaid'),
  1, 'one anonymous outcome row: channel, heard_from, free scan, people found, not paid');
select lives_ok($$ select public.purge_unpaid_accounts(50) $$, 'the purge runs again (deleteUser failed)');
select is((select count(*)::integer from public.signup_outcomes where channel = 'hn'), 1, 'and does not count the account twice');

select pg_temp.as_user('e3530000-0000-4000-8000-00000000000c', 'ft-owner@test.local');
set local role authenticated;
select ok((select jsonb_path_exists(public.cmo_funnel_report(30), '$.steps[*] ? (@.step == "free_scan")')
  and jsonb_typeof(public.cmo_funnel_report(30)->'by_channel') = 'array'), 'the owner funnel has the free scan step and a by-channel table');
reset role;

select * from finish();
rollback;
