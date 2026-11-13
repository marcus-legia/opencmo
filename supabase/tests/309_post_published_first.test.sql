-- 20270121010000: a post is published when its first platform posts (F1). The other platforms keep their slots and post
-- at their own times, a failed one keeps its Retry card and a Retry after its window gets a new time; "I posted it" on
-- the post card still cancels every waiting slot.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(23);

select hasnt_function('public', 'post_slots_open', array['uuid', 'uuid'], 'post_slots_open is gone');
select hasnt_trigger('public', 'schedule_slots', 'schedule_slots_settle_post', 'the settle trigger is gone');
select ok(not has_function_privilege('authenticated', 'public.post_schedules(text,uuid)', 'execute'), 'post_schedules is internal');

insert into auth.users (id, email) values ('e3090000-0000-4000-8000-00000000000a', 'first-a@test.local');
update public.profiles set plan = 'starter', credit_balance = 20, timezone = 'UTC' where id = 'e3090000-0000-4000-8000-00000000000a';
select public.zernio_profile_save('e3090000-0000-4000-8000-00000000000a', 'prof-first');
select public.social_account_save('e3090000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-first-x');
select public.social_account_save('e3090000-0000-4000-8000-00000000000a', 'linkedin', 'Founder', null, 'acc-first-li');
select public.social_account_save('e3090000-0000-4000-8000-00000000000a', 'threads', '@founder', null, 'acc-first-th');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3091000-0000-4000-8000-00000000000a', 'e3090000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'done');

insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3092000-0000-4000-8000-000000000001', 'e3090000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Three', 'approved',
   '{"text":"One core post, three platforms.","targets":["x","linkedin","threads"]}'),
  ('e3092000-0000-4000-8000-000000000002', 'e3090000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 1, 'By hand', 'approved',
   '{"text":"Posted by hand.","targets":["x","linkedin"]}'),
  ('e3092000-0000-4000-8000-000000000003', 'e3090000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 2, 'One', 'approved',
   '{"text":"Only X.","targets":["x"]}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3093000-0000-4000-8000-000000000001', 'e3090000-0000-4000-8000-00000000000a', 'e3091000-0000-4000-8000-00000000000a', 'post',
   'content_item', 'e3092000-0000-4000-8000-000000000001', 'decided'),
  ('e3093000-0000-4000-8000-000000000002', 'e3090000-0000-4000-8000-00000000000a', 'e3091000-0000-4000-8000-00000000000a', 'post',
   'content_item', 'e3092000-0000-4000-8000-000000000002', 'decided'),
  ('e3093000-0000-4000-8000-000000000003', 'e3090000-0000-4000-8000-00000000000a', 'e3091000-0000-4000-8000-00000000000a', 'post',
   'content_item', 'e3092000-0000-4000-8000-000000000003', 'decided');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000001'), 3,
  'three platforms, three slots');
update public.schedule_slots set status = 'waiting' where deliverable_id in ('e3093000-0000-4000-8000-000000000001', 'e3093000-0000-4000-8000-000000000002');

-- Review focus 1: X posts, LinkedIn fails, Threads posts after.
select public.publish_status((select id from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000001' and platform = 'x'),
  'published', 'ext-first-x', 'https://x.com/founder/status/9');
select is((select status from public.content_items where id = 'e3092000-0000-4000-8000-000000000001'), 'published',
  'X posted: the post is published');
select is((select external_url from public.content_items where id = 'e3092000-0000-4000-8000-000000000001'), 'https://x.com/founder/status/9',
  'with the first platform''s link');
select is((select array_agg(status order by platform) from public.schedule_slots
  where deliverable_id = 'e3093000-0000-4000-8000-000000000001' and platform <> 'x'), array['waiting', 'waiting'],
  'LinkedIn and Threads keep their slots');
select is(coalesce(current_setting('opencmo.slot_published', true), ''), '', 'the flag does not outlive the update');

select public.publish_status((select id from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000001' and platform = 'linkedin'),
  'failed', null, null, '{"message":"LinkedIn said no."}');
select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where a.ref_kind = 'schedule_slot' and s.deliverable_id = 'e3093000-0000-4000-8000-000000000001' and s.platform = 'linkedin'
    and s.status = 'failed' and a.status = 'waiting'), 1, 'LinkedIn failed and keeps its Retry card');

select public.publish_status((select id from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000001' and platform = 'threads'),
  'published', 'ext-first-th', 'https://www.threads.com/@founder/post/abc');
select is((select status from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000001' and platform = 'threads'), 'published',
  'Threads still posts after X');
select is((select external_url from public.content_items where id = 'e3092000-0000-4000-8000-000000000001'), 'https://x.com/founder/status/9',
  'the post keeps the first link');

-- A Retry after LinkedIn's window gets a new time, though the post is published.
update public.schedule_slots set publish_at = now() - interval '2 hours', window_ends_at = now() - interval '1 hour'
where deliverable_id = 'e3093000-0000-4000-8000-000000000001' and platform = 'linkedin';
-- The card shows the slot as it is now (its time is in the snapshot), still open as the founder taps Retry.
select public.approval_raise(user_id, 'schedule_slot', id) from public.schedule_slots
where deliverable_id = 'e3093000-0000-4000-8000-000000000001' and platform = 'linkedin';
update public.approvals a set expires_at = now() + interval '1 minute' from public.schedule_slots s
where a.ref_kind = 'schedule_slot' and a.ref_id = s.id and a.status = 'waiting'
  and s.deliverable_id = 'e3093000-0000-4000-8000-000000000001' and s.platform = 'linkedin';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3090000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.approval_decide(a.id, 'retry', jsonb_build_object('content_hash', a.content_hash))
  from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where a.ref_kind = 'schedule_slot' and s.deliverable_id = 'e3093000-0000-4000-8000-000000000001' and s.platform = 'linkedin'
    and a.status = 'waiting' $$, 'the founder retries LinkedIn after its window');
reset role;
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000001'
  and platform = 'linkedin' and status = 'proposed'), 1, 'LinkedIn gets a new time on a card');

-- A waiting slot of a published post that is missed is asked again, too.
select public.schedule_miss(s, null) from public.schedule_slots s
where deliverable_id = 'e3093000-0000-4000-8000-000000000001' and platform = 'linkedin' and status = 'proposed';
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000001'
  and platform = 'linkedin' and status = 'proposed'), 1, 'a missed slot of a published post gets a new time');

-- Review focus 2: "I posted it" on the post card cancels every waiting slot and its card.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3090000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.cmo_mark_posted('e3092000-0000-4000-8000-000000000002') $$, 'the founder posted it by hand');
reset role;
select is((select array_agg(status order by platform) from public.schedule_slots
  where deliverable_id = 'e3093000-0000-4000-8000-000000000002'), array['cancelled', 'cancelled'], 'every waiting slot is cancelled');
select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where a.ref_kind = 'schedule_slot' and s.deliverable_id = 'e3093000-0000-4000-8000-000000000002' and a.status = 'waiting'), 0,
  'and no card waits');
select is(public.schedule_propose('e3093000-0000-4000-8000-000000000002'), 0, 'a post posted by hand is not scheduled again');

-- One platform marked posted (copy and open) is the post published; the others keep their slots.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3092000-0000-4000-8000-000000000004', 'e3090000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 3, 'Mixed', 'approved',
   '{"text":"Facebook by hand, X by itself.","targets":["x","facebook"]}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e3093000-0000-4000-8000-000000000004', 'e3090000-0000-4000-8000-00000000000a', 'e3091000-0000-4000-8000-00000000000a', 'post',
   'content_item', 'e3092000-0000-4000-8000-000000000004', 'decided');
update public.schedule_slots set status = 'waiting' where deliverable_id = 'e3093000-0000-4000-8000-000000000004' and platform = 'x';
select public.publish_status((select id from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000004' and platform = 'facebook'),
  'intent');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3090000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.schedule_mark_posted((select id from public.schedule_slots
  where deliverable_id = 'e3093000-0000-4000-8000-000000000004' and platform = 'facebook')) $$, 'Facebook is marked posted');
reset role;
select is((select status from public.content_items where id = 'e3092000-0000-4000-8000-000000000004'), 'published', 'the post is published');
select is((select status from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000004' and platform = 'x'), 'waiting',
  'X keeps its slot');

-- A post for one platform behaves as before.
update public.schedule_slots set status = 'waiting' where deliverable_id = 'e3093000-0000-4000-8000-000000000003';
select public.publish_status((select id from public.schedule_slots where deliverable_id = 'e3093000-0000-4000-8000-000000000003'),
  'published', 'ext-one-x', 'https://x.com/founder/status/10');
select is((select status from public.content_items where id = 'e3092000-0000-4000-8000-000000000003'), 'published', 'one platform posted: published');
select is(public.schedule_propose('e3093000-0000-4000-8000-000000000003'), 0, 'and nothing more is scheduled');

select * from finish();
rollback;
