-- 20270206090000: a post approved while its platform had no account got no slot (20270206040000), and nothing asked
-- again. Connecting that platform now proposes its time; a save that only refreshes the account adds nothing.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(6);

insert into auth.users (id, email) values ('e3640000-0000-4000-8000-00000000000a', 'connectlater@test.local');
update public.profiles set plan = 'starter', timezone = 'Asia/Ho_Chi_Minh' where id = 'e3640000-0000-4000-8000-00000000000a';
select public.zernio_profile_save('e3640000-0000-4000-8000-00000000000a', 'prof-364');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3641000-0000-4000-8000-00000000000a', 'e3640000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'waiting_founder');
-- Today's Threads post, and yesterday's, both approved with no Threads account.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3642000-0000-4000-8000-00000000000a', 'e3640000-0000-4000-8000-00000000000a', 'post', 'threads', current_date, 'Today',
   'in_review', '{"text":"Start from the sentence a buyer would write.","targets":["threads"],"proposed":null}'),
  ('e3642000-0000-4000-8000-00000000000b', 'e3640000-0000-4000-8000-00000000000a', 'post', 'threads', current_date - 1, 'Yesterday',
   'in_review', '{"text":"An older post.","targets":["threads"],"proposed":null}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3643000-0000-4000-8000-00000000000a', 'e3640000-0000-4000-8000-00000000000a', 'e3641000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e3642000-0000-4000-8000-00000000000a', 'waiting_founder'),
  ('e3643000-0000-4000-8000-00000000000b', 'e3640000-0000-4000-8000-00000000000a', 'e3641000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e3642000-0000-4000-8000-00000000000b', 'waiting_founder');
update public.content_items set status = 'approved' where user_id = 'e3640000-0000-4000-8000-00000000000a';
update public.deliverables set status = 'decided' where user_id = 'e3640000-0000-4000-8000-00000000000a';

select is((select count(*)::int from public.schedule_slots where user_id = 'e3640000-0000-4000-8000-00000000000a'), 0,
  'approved with no account: no slot yet');

-- Connecting X schedules nothing: neither post targets it.
select public.social_account_save('e3640000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-364-x');
select is((select count(*)::int from public.schedule_slots where user_id = 'e3640000-0000-4000-8000-00000000000a'), 0,
  'connecting another platform schedules nothing');

select public.social_account_save('e3640000-0000-4000-8000-00000000000a', 'threads', '@founder', null, 'acc-364-th');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3643000-0000-4000-8000-00000000000a'), 1,
  'connecting Threads gives today''s approved post its slot');
select is((select mode from public.schedule_slots where deliverable_id = 'e3643000-0000-4000-8000-00000000000a'), 'publish',
  'on the account just connected');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3643000-0000-4000-8000-00000000000b'), 0,
  'a post of a past day is left alone');

select public.social_account_save('e3640000-0000-4000-8000-00000000000a', 'threads', '@renamed', null, 'acc-364-th');
select is((select count(*)::int from public.schedule_slots where user_id = 'e3640000-0000-4000-8000-00000000000a'), 1,
  'refreshing the account adds no second slot');

select * from finish();
rollback;
