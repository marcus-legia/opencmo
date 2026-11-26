-- 20270206050000: disconnecting an account drops the posts waiting on it. They used to become `intent` slots that
-- asked the founder to post by hand; since 20270206040000 a post with no connected account is not scheduled at all,
-- so such a slot could only sit on the calendar and settle `failed` with `no_account`.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

insert into auth.users (id, email) values ('e3600000-0000-4000-8000-00000000000a', 'disconnect@test.local');
update public.profiles set timezone = 'Asia/Ho_Chi_Minh' where id = 'e3600000-0000-4000-8000-00000000000a';
insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3601100-0000-4000-8000-00000000000a', 'e3600000-0000-4000-8000-00000000000a', 'linkedin', 'founder', 'z-li-360');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3601000-0000-4000-8000-00000000000a', 'e3600000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'waiting_founder');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3602000-0000-4000-8000-00000000000a', 'e3600000-0000-4000-8000-00000000000a', 'post', 'linkedin', current_date, 'Why',
   'in_review', '{"text":"Start from the sentence a buyer would write."}');
update public.content_items set body = body || '{"proposed":null}' where id = 'e3602000-0000-4000-8000-00000000000a';
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3603000-0000-4000-8000-00000000000a', 'e3600000-0000-4000-8000-00000000000a', 'e3601000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e3602000-0000-4000-8000-00000000000a', 'waiting_founder');
update public.content_items set status = 'approved' where id = 'e3602000-0000-4000-8000-00000000000a';
update public.deliverables set status = 'decided' where id = 'e3603000-0000-4000-8000-00000000000a';

select is((select status || ' ' || mode from public.schedule_slots where deliverable_id = 'e3603000-0000-4000-8000-00000000000a'),
  'proposed publish', 'the connected account gets a slot that posts on its own');

-- The founder disconnects LinkedIn. `social_account_remove` runs as them.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e3600000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.social_account_remove('e3601100-0000-4000-8000-00000000000a');
reset role;

select is((select status from public.schedule_slots where deliverable_id = 'e3603000-0000-4000-8000-00000000000a'), 'cancelled',
  'disconnecting drops the post waiting on it');
select is((select count(*)::int from public.schedule_slots
  where deliverable_id = 'e3603000-0000-4000-8000-00000000000a' and mode = 'intent'), 0,
  'it is not turned into a post to copy by hand');
select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e3603000-0000-4000-8000-00000000000a' and a.status in ('waiting', 'held')), 0,
  'and its card is closed, not left asking');

select * from finish();
rollback;
