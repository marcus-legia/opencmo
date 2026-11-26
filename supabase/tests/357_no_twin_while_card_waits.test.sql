-- 20270206020000: a failed slot gets no twin while its Retry card is still undecided. Before this, `windowMinutes`
-- (15) was the only gate, so a quarter of an hour after any failure the next `schedule_propose` silently made a
-- second slot for the same post and platform, and the founder saw the post two or three times on the calendar.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

insert into auth.users (id, email) values ('e3570000-0000-4000-8000-00000000000a', 'twin@test.local');
update public.profiles set timezone = 'Asia/Ho_Chi_Minh' where id = 'e3570000-0000-4000-8000-00000000000a';
-- A post is scheduled only where an account is connected (20270206040000).
insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3571100-0000-4000-8000-00000000000a', 'e3570000-0000-4000-8000-00000000000a', 'linkedin', 'founder', 'z-li-357');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3571000-0000-4000-8000-00000000000a', 'e3570000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'waiting_founder');

-- An approved post with no time of its own: its slot and its card come from `schedule_propose`.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3572000-0000-4000-8000-00000000000a', 'e3570000-0000-4000-8000-00000000000a', 'post', 'linkedin', current_date, 'Why',
   'in_review', '{"text":"Why we started from the buyer''s own sentence."}');
update public.content_items set body = body || '{"proposed":null}' where id = 'e3572000-0000-4000-8000-00000000000a';
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3573000-0000-4000-8000-00000000000a', 'e3570000-0000-4000-8000-00000000000a', 'e3571000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e3572000-0000-4000-8000-00000000000a', 'waiting_founder');
update public.content_items set status = 'approved' where id = 'e3572000-0000-4000-8000-00000000000a';
update public.deliverables set status = 'decided' where id = 'e3573000-0000-4000-8000-00000000000a';

select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3573000-0000-4000-8000-00000000000a'), 1,
  'the approved post has one slot');

-- It fired and failed on something that fails again on the same words (no connected account), and its window has
-- passed. The founder has a Retry card waiting.
update public.schedule_slots
set status = 'failed', window_ends_at = now() - interval '1 hour', publish_at = now() - interval '2 hours',
    error = jsonb_build_object('code', 'no_account', 'message', 'No connected LinkedIn account.', 'retryable', true)
where deliverable_id = 'e3573000-0000-4000-8000-00000000000a';
select public.approval_raise('e3570000-0000-4000-8000-00000000000a', 'schedule_slot', id)
from public.schedule_slots where deliverable_id = 'e3573000-0000-4000-8000-00000000000a';

select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e3573000-0000-4000-8000-00000000000a' and a.status in ('waiting', 'held')), 1,
  'the failure left one card for the founder');

-- The bug: this call used to insert a twin, because the window had passed.
select is(public.schedule_propose('e3573000-0000-4000-8000-00000000000a'), 0,
  'no new time is proposed while the card waits');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3573000-0000-4000-8000-00000000000a'), 1,
  'still one slot: the post is not on the calendar twice');

-- Once the founder decides, the existing Retry path asks for a new time.
update public.approvals set status = 'approved', decided_at = now()
where ref_kind = 'schedule_slot' and status in ('waiting', 'held')
  and ref_id in (select id from public.schedule_slots where deliverable_id = 'e3573000-0000-4000-8000-00000000000a');
select public.schedule_propose('e3573000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3573000-0000-4000-8000-00000000000a'), 2,
  'a decided card frees the next time');

select * from finish();
rollback;
