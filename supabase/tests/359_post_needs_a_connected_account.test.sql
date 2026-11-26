-- 20270206040000: a post is scheduled only for a platform with a connected account. It used to get an `intent` slot
-- instead, meant for copying by hand; that slot could only settle `failed` with `no_account`, and the failure asked
-- for a new time, so one platform chosen at onboarding and never connected filled the calendar with copies.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(6);

insert into auth.users (id, email) values ('e3590000-0000-4000-8000-00000000000a', 'needsaccount@test.local');
update public.profiles set timezone = 'Asia/Ho_Chi_Minh' where id = 'e3590000-0000-4000-8000-00000000000a';
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3591000-0000-4000-8000-00000000000a', 'e3590000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'waiting_founder');

-- One post for both X and Threads. X is connected; Threads was chosen but never connected.
insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3591100-0000-4000-8000-00000000000a', 'e3590000-0000-4000-8000-00000000000a', 'x', 'founder', 'z-x-359');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3592000-0000-4000-8000-00000000000a', 'e3590000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Why',
   'in_review', '{"text":"Start from the sentence a buyer would write.","targets":["x","threads"]}');
update public.content_items set body = body || '{"proposed":null}' where id = 'e3592000-0000-4000-8000-00000000000a';
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3593000-0000-4000-8000-00000000000a', 'e3590000-0000-4000-8000-00000000000a', 'e3591000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e3592000-0000-4000-8000-00000000000a', 'waiting_founder');
update public.content_items set status = 'approved' where id = 'e3592000-0000-4000-8000-00000000000a';
update public.deliverables set status = 'decided' where id = 'e3593000-0000-4000-8000-00000000000a';

select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3593000-0000-4000-8000-00000000000a'), 1,
  'the post gets one slot, not one per target');
select is((select platform from public.schedule_slots where deliverable_id = 'e3593000-0000-4000-8000-00000000000a'), 'x',
  'and it is the connected platform');
select is((select count(*)::int from public.schedule_slots
  where deliverable_id = 'e3593000-0000-4000-8000-00000000000a' and platform = 'threads'), 0,
  'the unconnected platform gets nothing at all');
select is((select count(*)::int from public.schedule_slots
  where deliverable_id = 'e3593000-0000-4000-8000-00000000000a' and mode = 'intent'), 0,
  'and no intent slot is left to fail at its time');

-- Connecting Threads lets its post be scheduled the next time the post is looked at.
insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3591200-0000-4000-8000-00000000000a', 'e3590000-0000-4000-8000-00000000000a', 'threads', 'founder', 'z-th-359');
select is(public.schedule_propose('e3593000-0000-4000-8000-00000000000a'), 1, 'connecting it proposes its time');
select is((select mode from public.schedule_slots
  where deliverable_id = 'e3593000-0000-4000-8000-00000000000a' and platform = 'threads'), 'publish',
  'and the slot posts on its own account');

select * from finish();
rollback;
