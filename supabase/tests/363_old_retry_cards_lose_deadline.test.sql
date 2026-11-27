-- 20270206080000: a Retry card raised before 20270206030000 kept `expires_at = window_ends_at`, so the app showed it
-- as expired while it still held its slot (20270206020000) and no new card could come. The migration clears that old
-- deadline on every undecided failure card; a card waiting for its time keeps its own.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

insert into auth.users (id, email) values ('e3630000-0000-4000-8000-00000000000a', 'oldretry@test.local');
insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3631100-0000-4000-8000-00000000000a', 'e3630000-0000-4000-8000-00000000000a', 'linkedin', 'founder', 'z-li-363');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3631000-0000-4000-8000-00000000000a', 'e3630000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'waiting_founder');
-- Two approved posts: one will fail, one only waits for its time.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3632000-0000-4000-8000-00000000000a', 'e3630000-0000-4000-8000-00000000000a', 'post', 'linkedin', current_date, 'One',
   'in_review', '{"text":"First post.","proposed":null}'),
  ('e3632000-0000-4000-8000-00000000000b', 'e3630000-0000-4000-8000-00000000000a', 'post', 'linkedin', current_date, 'Two',
   'in_review', '{"text":"Second post.","proposed":null}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3633000-0000-4000-8000-00000000000a', 'e3630000-0000-4000-8000-00000000000a', 'e3631000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e3632000-0000-4000-8000-00000000000a', 'waiting_founder'),
  ('e3633000-0000-4000-8000-00000000000b', 'e3630000-0000-4000-8000-00000000000a', 'e3631000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e3632000-0000-4000-8000-00000000000b', 'waiting_founder');
update public.content_items set status = 'approved' where user_id = 'e3630000-0000-4000-8000-00000000000a';
update public.deliverables set status = 'decided' where user_id = 'e3630000-0000-4000-8000-00000000000a';
-- Approving the post approved its time too; the second one asks for its time on a card of its own.
update public.schedule_slots set status = 'proposed' where deliverable_id = 'e3633000-0000-4000-8000-00000000000b';
select public.approval_raise('e3630000-0000-4000-8000-00000000000a', 'schedule_slot', id)
from public.schedule_slots where deliverable_id = 'e3633000-0000-4000-8000-00000000000b';

-- The first failed, and its Retry card is shaped as before 20270206030000: a deadline at the window's end, long past.
update public.schedule_slots
set status = 'failed', publish_at = now() - interval '2 hours', window_ends_at = now() - interval '105 minutes',
    error = jsonb_build_object('code', 'too_long', 'message', 'LinkedIn refused the post.', 'retryable', true)
where deliverable_id = 'e3633000-0000-4000-8000-00000000000a';
select public.approval_raise('e3630000-0000-4000-8000-00000000000a', 'schedule_slot', id)
from public.schedule_slots where deliverable_id = 'e3633000-0000-4000-8000-00000000000a';
update public.approvals a set expires_at = s.window_ends_at
from public.schedule_slots s
where a.ref_id = s.id and s.deliverable_id = 'e3633000-0000-4000-8000-00000000000a' and a.status = 'waiting';

select is(public.schedule_failure_cards_reopen(), 1, 'the old Retry card is reopened');
select is((select a.expires_at from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e3633000-0000-4000-8000-00000000000a' and a.status = 'waiting'), null,
  'it has no deadline, so the app no longer shows it as expired');
select is((select a.expires_at = s.publish_at from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e3633000-0000-4000-8000-00000000000b' and a.status = 'waiting'), true,
  'a card waiting for its time keeps its deadline');
select is(public.schedule_failure_cards_reopen(), 0, 'a rerun changes nothing');
select is(public.schedule_propose('e3633000-0000-4000-8000-00000000000a'), 0, 'the reopened card still holds its slot');

select * from finish();
rollback;
