-- 20270206070000: a founder whose plan lapsed is listed for the cleanup cron, and dropping the account cancels its
-- waiting posts the way the founder's own Disconnect does. A paid founder is never listed.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

select ok(not has_function_privilege('authenticated', 'public.lapsed_social_accounts(integer)', 'execute'), 'a founder cannot list lapsed accounts');
select ok(not has_function_privilege('authenticated', 'public.social_account_drop(uuid,uuid)', 'execute'), 'nor drop another founder''s account');

insert into auth.users (id, email) values
  ('e3620000-0000-4000-8000-00000000000a', 'lapsed@test.local'),
  ('e3620000-0000-4000-8000-00000000000b', 'stillpaid@test.local');
update public.profiles set plan = 'starter', timezone = 'UTC'
where id in ('e3620000-0000-4000-8000-00000000000a', 'e3620000-0000-4000-8000-00000000000b');
select public.zernio_profile_save('e3620000-0000-4000-8000-00000000000a', 'prof-362a');
select public.zernio_profile_save('e3620000-0000-4000-8000-00000000000b', 'prof-362b');
select public.social_account_save('e3620000-0000-4000-8000-00000000000a', 'x', '@lapsed', null, 'acc-362-a');
select public.social_account_save('e3620000-0000-4000-8000-00000000000b', 'x', '@paid', null, 'acc-362-b');

select is((select count(*)::int from public.lapsed_social_accounts(500)
  where user_id in ('e3620000-0000-4000-8000-00000000000a', 'e3620000-0000-4000-8000-00000000000b')), 0,
  'paid founders are not listed');

-- A post waits on A's X account, then A's plan ends.
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e3621000-0000-4000-8000-00000000000a', 'e3620000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
   'post_draft', 'Posts', '{}', 'writer', 'done');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3622000-0000-4000-8000-00000000000a', 'e3620000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 2, 'Later',
   'approved', '{"text":"A post for later.","targets":["x"]}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3623000-0000-4000-8000-00000000000a', 'e3620000-0000-4000-8000-00000000000a', 'e3621000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e3622000-0000-4000-8000-00000000000a', 'decided');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3623000-0000-4000-8000-00000000000a'
  and status in ('proposed', 'waiting')), 1, 'the post waits on the account');

update public.profiles set plan = 'free', credit_balance = 0 where id = 'e3620000-0000-4000-8000-00000000000a';
select is((select zernio_account_id from public.lapsed_social_accounts(500) where user_id = 'e3620000-0000-4000-8000-00000000000a'),
  'acc-362-a', 'the lapsed founder''s account is listed with its Zernio id');
select is((select count(*)::int from public.lapsed_social_accounts(500) where user_id = 'e3620000-0000-4000-8000-00000000000b'), 0,
  'the paid founder still is not');

select lives_ok($$ select public.social_account_drop('e3620000-0000-4000-8000-00000000000a',
  (select id from public.social_accounts where user_id = 'e3620000-0000-4000-8000-00000000000a')) $$, 'the cron drops it');
select is((select count(*)::int from public.social_accounts where user_id = 'e3620000-0000-4000-8000-00000000000a'), 0, 'the account is gone');
select is((select status from public.schedule_slots where deliverable_id = 'e3623000-0000-4000-8000-00000000000a'), 'cancelled',
  'and its waiting post is cancelled');

select * from finish();
rollback;
