-- P4 review fixes (20261230140000): each attempt uploads again and posts with its own key; a disconnected
-- account's slots ask again as copy and open; a failed slot in its window or an unconfirmed one gets no twin;
-- an unconfirmed post gets a card the founder can close with "It went out"; a published post closes its Retry card;
-- the slot route's rate-limit bucket exists.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(16);

insert into auth.users (id, email) values ('e2200000-0000-4000-8000-00000000000a', 'p4fix@test.local');
update public.profiles set timezone = 'UTC' where id = 'e2200000-0000-4000-8000-00000000000a';
select public.zernio_profile_save('e2200000-0000-4000-8000-00000000000a', 'prof-fix');
select public.social_account_save('e2200000-0000-4000-8000-00000000000a', 'x', '@fix', null, 'acc-fix-x');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e2201000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date, 'post_draft', 'Posts', '{}', 'writer', 'done');

-- Five X posts, kept in review so nothing is proposed by itself: a (attempts), b (disconnect), c (twin), d (unconfirmed),
-- e (published after a failure).
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
select ('e2202000-0000-4000-8000-00000000000' || c)::uuid, 'e2200000-0000-4000-8000-00000000000a', 'post', 'X', current_date,
  'Post ' || c, 'in_review', jsonb_build_object('text', 'Post ' || c || '.')
from unnest(array['a', 'b', 'c', 'd', 'e']) c;
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
select ('e2203000-0000-4000-8000-00000000000' || c)::uuid, 'e2200000-0000-4000-8000-00000000000a', 'e2201000-0000-4000-8000-00000000000a',
  'post', 'content_item', ('e2202000-0000-4000-8000-00000000000' || c)::uuid, 'decided'
from unnest(array['a', 'b', 'c', 'd', 'e']) c;
insert into public.schedule_slots (id, user_id, deliverable_id, platform, account_id, mode, publish_at, window_ends_at, status)
select ('e2204000-0000-4000-8000-00000000000' || c)::uuid, 'e2200000-0000-4000-8000-00000000000a',
  ('e2203000-0000-4000-8000-00000000000' || c)::uuid, 'x',
  (select id from public.social_accounts where user_id = 'e2200000-0000-4000-8000-00000000000a'), 'publish',
  case c when 'd' then now() - interval '3 hours' when 'a' then now() - interval '1 minute' else now() + interval '2 hours' end,
  case c when 'd' then now() - interval '2 hours 45 minutes' when 'a' then now() + interval '14 minutes' else now() + interval '2 hours 15 minutes' end,
  case c when 'a' then 'due' when 'd' then 'publishing' when 'e' then 'failed' when 'c' then 'failed' else 'waiting' end
from unnest(array['a', 'b', 'c', 'd', 'e']) c;
select public.approval_raise(user_id, 'schedule_slot', id) from public.schedule_slots where id::text like 'e2204000-%';
update public.approvals set status = 'approved', decided_at = now()
where ref_kind = 'schedule_slot' and ref_id in ('e2204000-0000-4000-8000-00000000000a', 'e2204000-0000-4000-8000-00000000000b', 'e2204000-0000-4000-8000-00000000000d');

-- a: the order the sweep made for it, and an upload left from an earlier attempt.
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status, root_id, parent_id) values
  ('e2201000-0000-4000-8000-0000000000a1', 'e2200000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date, 'publish_post', 'Post on X',
   '{"slot_id":"e2204000-0000-4000-8000-00000000000a"}', 'publish', 'running',
   'e2201000-0000-4000-8000-00000000000a', 'e2201000-0000-4000-8000-00000000000a');
insert into public.tasks (id, user_id, kind, payload, request_id, status) values
  ('e2205000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a', 'publish_media', '{}', gen_random_uuid(), 'done');
update public.schedule_slots set media_task_id = 'e2205000-0000-4000-8000-00000000000a', attempts = 1 where id = 'e2204000-0000-4000-8000-00000000000a';

select public.publish_slot_start('e2204000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a', 'e2201000-0000-4000-8000-0000000000a1');
select is((select media_task_id from public.schedule_slots where id = 'e2204000-0000-4000-8000-00000000000a'), null,
  'a new attempt forgets the earlier upload');
select is((public.publish_slot_read('e2204000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a', 'e2201000-0000-4000-8000-0000000000a1')->>'media')::jsonb,
  '{"state": "none"}'::jsonb, 'so it uploads the export of what is approved now');
select is(public.publish_slot_read('e2204000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a', 'e2201000-0000-4000-8000-0000000000a1')->>'idempotencyKey',
  (select idempotency_key || ':2' from public.schedule_slots where id = 'e2204000-0000-4000-8000-00000000000a'), 'and posts with the attempt''s own key');

-- c: failed, its window still open (a Retry card) → proposing again gives it no twin.
update public.content_items set status = 'approved' where id = 'e2202000-0000-4000-8000-00000000000c';
select public.schedule_propose('e2203000-0000-4000-8000-00000000000c');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e2203000-0000-4000-8000-00000000000c'), 1,
  'a failure still in its window gets no second slot');

-- d: Zernio took it and never confirmed it → failed/unconfirmed with a card that waits.
select public.schedule_claim_due();
select is((select status || ':' || (error->>'code') from public.schedule_slots where id = 'e2204000-0000-4000-8000-00000000000d'),
  'failed:unconfirmed', 'unconfirmed after an hour past its window');
select is((select count(*)::int from public.approvals where ref_kind = 'schedule_slot' and ref_id = 'e2204000-0000-4000-8000-00000000000d' and status = 'waiting'), 1,
  'it gets a card');
select is((select expires_at from public.approvals where ref_kind = 'schedule_slot' and ref_id = 'e2204000-0000-4000-8000-00000000000d' and status = 'waiting'), null,
  'that does not expire');
update public.content_items set status = 'approved' where id = 'e2202000-0000-4000-8000-00000000000d';
select public.schedule_propose('e2203000-0000-4000-8000-00000000000d');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e2203000-0000-4000-8000-00000000000d'), 1,
  'an unconfirmed post (maybe live) gets no second slot');

-- e: failed, then the webhook says it went out → published, its Retry card closed.
select public.publish_status('e2204000-0000-4000-8000-00000000000e', 'published', 'ext-e', 'https://x.com/fix/status/1');
select is((select status from public.schedule_slots where id = 'e2204000-0000-4000-8000-00000000000e'), 'published', 'e is published');
select is((select count(*)::int from public.approvals where ref_kind = 'schedule_slot' and ref_id = 'e2204000-0000-4000-8000-00000000000e' and status = 'waiting'), 0,
  'and its Retry card is closed');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2200000-0000-4000-8000-00000000000a"}';
-- d: the founder checked and it is live.
select is((select status from public.schedule_mark_posted('e2204000-0000-4000-8000-00000000000d')), 'approved', '"It went out" closes the unconfirmed card');
-- b: disconnecting X turns its waiting slot into a copy-and-open proposal with a card that can be decided.
select public.social_account_remove((select id from public.social_accounts where user_id = 'e2200000-0000-4000-8000-00000000000a'));
select is(public.rate_limit_hit('schedule', 120, 3600), true, 'the slot route''s bucket exists');
reset role;

select is((select status from public.schedule_slots where id = 'e2204000-0000-4000-8000-00000000000d'), 'published', 'd is published');
select is((select status || ':' || mode || ':' || coalesce(account_id::text, '-') from public.schedule_slots where id = 'e2204000-0000-4000-8000-00000000000b'),
  'proposed:intent:-', 'b asks again as copy and open');
select is((select count(*)::int from public.approvals where ref_kind = 'schedule_slot' and ref_id = 'e2204000-0000-4000-8000-00000000000b' and status = 'waiting'), 1,
  'with a new card');
select is((select content_hash = public.approval_hash(public.approval_snapshot('schedule_slot', 'e2204000-0000-4000-8000-00000000000b'))
  from public.approvals where ref_kind = 'schedule_slot' and ref_id = 'e2204000-0000-4000-8000-00000000000b' and status = 'waiting'), true,
  'that matches the slot as it is now (so it can be decided)');

select * from finish();
rollback;
