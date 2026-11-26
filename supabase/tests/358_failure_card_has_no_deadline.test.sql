-- 20270206030000: a Retry card waits until the founder decides it. It used to carry `expires_at = window_ends_at`,
-- so 15 minutes after the post's time it was past its deadline and dropped out of every view that hides an expired
-- card, while still holding the slot. A card the founder cannot see is a decision they cannot make.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

insert into auth.users (id, email) values ('e3580000-0000-4000-8000-00000000000a', 'deadline@test.local');
update public.profiles set timezone = 'Asia/Ho_Chi_Minh' where id = 'e3580000-0000-4000-8000-00000000000a';
-- A post is scheduled only where an account is connected (20270206040000).
insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3581100-0000-4000-8000-00000000000a', 'e3580000-0000-4000-8000-00000000000a', 'linkedin', 'founder', 'z-li-358');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3581000-0000-4000-8000-00000000000a', 'e3580000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'waiting_founder');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3582000-0000-4000-8000-00000000000a', 'e3580000-0000-4000-8000-00000000000a', 'post', 'linkedin', current_date, 'Why',
   'in_review', '{"text":"Start from the sentence a buyer would write."}');
update public.content_items set body = body || '{"proposed":null}' where id = 'e3582000-0000-4000-8000-00000000000a';
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3583000-0000-4000-8000-00000000000a', 'e3580000-0000-4000-8000-00000000000a', 'e3581000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e3582000-0000-4000-8000-00000000000a', 'waiting_founder');
update public.content_items set status = 'approved' where id = 'e3582000-0000-4000-8000-00000000000a';
update public.deliverables set status = 'decided' where id = 'e3583000-0000-4000-8000-00000000000a';

-- A schedule card that is only waiting for its time still expires at that time.
select is((select a.expires_at = s.publish_at from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e3583000-0000-4000-8000-00000000000a' and a.status = 'waiting'), true,
  'a card waiting for its time expires at its time');

-- It fired and failed. The card raised for the failure carries the error and no deadline.
update public.schedule_slots
set status = 'failed', publish_at = now() - interval '2 hours', window_ends_at = now() - interval '105 minutes',
    error = jsonb_build_object('code', 'too_long', 'message', 'X refused the post.', 'retryable', true)
where deliverable_id = 'e3583000-0000-4000-8000-00000000000a';
select public.approval_raise('e3580000-0000-4000-8000-00000000000a', 'schedule_slot', id)
from public.schedule_slots where deliverable_id = 'e3583000-0000-4000-8000-00000000000a';

select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e3583000-0000-4000-8000-00000000000a' and a.status = 'waiting'), 1,
  'the failure leaves one waiting card');
select is((select a.expires_at from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e3583000-0000-4000-8000-00000000000a' and a.status = 'waiting'), null,
  'the Retry card has no deadline, long after the window closed');
select is((select a.status from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e3583000-0000-4000-8000-00000000000a' and a.status in ('waiting', 'held')), 'waiting',
  'and is waiting, not held by the day''s card budget');

-- Its slot is still the only one: the card holds the place (20270206020000).
select is(public.schedule_propose('e3583000-0000-4000-8000-00000000000a'), 0,
  'a card with no deadline still holds the slot');

select * from finish();
rollback;
