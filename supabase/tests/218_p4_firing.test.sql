-- P4 A2 (20261230120000): the sweep fires a due, still-approved slot once, into one publish_post order and run; a
-- slot past its window is missed, never late; a changed post is not posted; a paused founder's slots wait; the
-- handler's start re-checks everything; status comes back by slot or by Zernio's id; a failure's Retry posts with
-- the same key while the window lasts.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(36);

insert into auth.users (id, email) values
  ('e2180000-0000-4000-8000-00000000000a', 'p4a2@test.local'),
  ('e2180000-0000-4000-8000-00000000000b', 'p4a2-paused@test.local');
update public.profiles set timezone = 'UTC' where id in ('e2180000-0000-4000-8000-00000000000a', 'e2180000-0000-4000-8000-00000000000b');
update public.profiles set cmo_paused_at = now() where id = 'e2180000-0000-4000-8000-00000000000b';
select public.zernio_profile_save('e2180000-0000-4000-8000-00000000000a', 'prof-a2');
select public.social_account_save('e2180000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-a2-x');
select public.zernio_profile_save('e2180000-0000-4000-8000-00000000000b', 'prof-a2b');
select public.social_account_save('e2180000-0000-4000-8000-00000000000b', 'x', '@paused', null, 'acc-a2b-x');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e2181000-0000-4000-8000-00000000000a', 'e2180000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date, 'post_draft', 'Posts', '{}', 'writer', 'done'),
  ('e2181000-0000-4000-8000-00000000000b', 'e2180000-0000-4000-8000-00000000000b', date_trunc('week', current_date)::date, 'post_draft', 'Posts', '{}', 'writer', 'done');

-- Seven posts, kept in review so the event rule proposes nothing by itself; each test slot is made by hand.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
select ('e2182000-0000-4000-8000-00000000000' || c)::uuid,
  case when c = 'e' then 'e2180000-0000-4000-8000-00000000000b' else 'e2180000-0000-4000-8000-00000000000a' end::uuid,
  'post', 'x', current_date, 'Post ' || c, 'in_review', jsonb_build_object('text', 'Post ' || c || '.')
from unnest(array['a', 'b', 'c', 'd', 'e', 'f', '9']) c;
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
select ('e2183000-0000-4000-8000-00000000000' || c)::uuid, ci.user_id,
  case when c = 'e' then 'e2181000-0000-4000-8000-00000000000b' else 'e2181000-0000-4000-8000-00000000000a' end::uuid,
  'post', 'content_item', ci.id, 'decided'
from unnest(array['a', 'b', 'c', 'd', 'e', 'f', '9']) c join public.content_items ci on ci.id = ('e2182000-0000-4000-8000-00000000000' || c)::uuid;

-- a: due (publish). b: due (intent). c: due, changed after approval. d: past its window. e: due, founder paused.
-- f: due, will fail and be retried. 9: publishing, never confirmed.
insert into public.schedule_slots (id, user_id, deliverable_id, platform, account_id, mode, publish_at, window_ends_at, status)
select ('e2184000-0000-4000-8000-00000000000' || c)::uuid, d.user_id, d.id, 'x',
  case when c = 'b' then null else (select id from public.social_accounts a where a.user_id = d.user_id) end,
  case when c = 'b' then 'intent' else 'publish' end,
  case c when 'd' then now() - interval '30 minutes' when '9' then now() - interval '3 hours' else now() - interval '1 minute' end,
  case c when 'd' then now() - interval '15 minutes' when '9' then now() - interval '2 hours 45 minutes' else now() + interval '14 minutes' end,
  case when c = '9' then 'publishing' else 'waiting' end
from unnest(array['a', 'b', 'c', 'd', 'e', 'f', '9']) c join public.deliverables d on d.id = ('e2183000-0000-4000-8000-00000000000' || c)::uuid;
-- Their cards, approved (as the founder would have before the time came).
select public.approval_raise(user_id, 'schedule_slot', id) from public.schedule_slots where id::text like 'e2184000-%';
update public.approvals set status = 'approved', decided_at = now() where ref_kind = 'schedule_slot' and ref_id::text like 'e2184000-%';
update public.content_items set body = '{"text":"Post c, changed."}' where id = 'e2182000-0000-4000-8000-00000000000c';

create temp table claim1 as select public.schedule_claim_due() as r;
select is((select (r->>'fired')::int from claim1), 2, 'two due slots fire; the intent one reminds and the paused founder''s waits');
select is((select (r->>'unconfirmed')::int from claim1), 1, 'one unconfirmed post is reported');

select is((select status from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000a'), 'due', 'a: due');
select is((select lease_until = window_ends_at from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000a'), true,
  'leased until its window ends');
select is((select count(*)::int from public.work_orders where kind = 'publish_post' and brief->>'slot_id' = 'e2184000-0000-4000-8000-00000000000a'),
  1, 'one publish_post order');
select is((select department from public.work_orders where kind = 'publish_post' and brief->>'slot_id' = 'e2184000-0000-4000-8000-00000000000a'),
  'publish', 'in Publish');
select is((select count(*)::int from public.cmo_runs where kind = 'publish_post' and input->>'slot_id' = 'e2184000-0000-4000-8000-00000000000a'),
  1, 'and its run, queued for the web app');
select is((select status || ':' || (error->>'code') from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000b'), 'failed:no_account',
  'b: no account, its copy-and-open card (20261230140000)');
select is((select status || ' · ' || (error->>'message') from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000c'),
  'missed · It changed after you approved it.', 'c: changed after approval, never posted');
select is((select status from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000d'), 'missed', 'd: past its window, never late');
select is((select status from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000e'), 'waiting', 'e: paused founder, nothing moves');
select is((select status || ' · ' || (error->>'code') from public.schedule_slots where id = 'e2184000-0000-4000-8000-000000000009'),
  'failed · unconfirmed', '9: never confirmed, never posted again by itself');

select is((public.schedule_claim_due()->>'fired')::int, 0, 'claiming again fires nothing: never twice');
select is((select count(*)::int from public.cmo_runs where kind = 'publish_post' and input->>'slot_id' = 'e2184000-0000-4000-8000-00000000000a'),
  1, 'still one run');

-- The handler starts (the run names its user and the order the claim made).
create temp view orders as select brief->>'slot_id' as slot, id, user_id from public.work_orders where kind = 'publish_post';
create temp table started as select public.publish_slot_start('e2184000-0000-4000-8000-00000000000a', 'e2180000-0000-4000-8000-00000000000a',
  (select id from orders where slot = 'e2184000-0000-4000-8000-00000000000a')) as r;
create temp table readback as select public.publish_slot_read('e2184000-0000-4000-8000-00000000000a', 'e2180000-0000-4000-8000-00000000000a',
  (select id from orders where slot = 'e2184000-0000-4000-8000-00000000000a')) as r;
select is((select r->>'zernioAccountId' from readback), 'acc-a2-x', 'it posts from the approved account');
select is((select r->>'idempotencyKey' from readback),
  (select idempotency_key || ':' || attempts from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000a'),
  'with the slot''s key for this attempt (20261230140000)');
select is((select r->>'approvalStatus' from readback), 'approved', 'on an approved card');
select is((select r->'current'->>'text' from readback), 'Post a.', 'the approved words');
select is((select (r).status || ' ' || (r).attempts from started), 'publishing 1', 'publishing, attempt 1');
select is((public.publish_slot_start('e2184000-0000-4000-8000-00000000000a', 'e2180000-0000-4000-8000-00000000000a',
  (select id from orders where slot = 'e2184000-0000-4000-8000-00000000000a'))).attempts, 1, 'starting again (a re-entrant run) counts no new attempt');

-- Status by slot, then by Zernio's id.
select public.publish_status('e2184000-0000-4000-8000-00000000000a', 'publishing', 'zp_1');
select is((select status || ' ' || external_id from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000a'), 'publishing zp_1',
  'accepted: it waits for the webhook');
select public.publish_status(null, 'published', 'zp_1', 'https://x.com/founder/status/1', null, 'acc-a2-x');
select is((select status || ' ' || external_url from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000a'),
  'published https://x.com/founder/status/1', 'the webhook confirms it by Zernio''s id');
select is((select status || ' ' || external_url from public.content_items where id = 'e2182000-0000-4000-8000-00000000000a'),
  'published https://x.com/founder/status/1', 'the post is published with its link');
select lives_ok($$ select public.publish_status(null, 'published', 'zp_1', 'https://x.com/founder/status/1') $$, 'a replayed confirmation is a no-op');
select is((public.publish_status(null, 'failed', 'zp_1', null, '{"message":"late event"}')).status, 'published',
  'a published post never moves back');
select throws_ok($$ select public.publish_status(null, 'published', 'zp_nope') $$, 'P0002', null, 'an unknown post id is refused');

-- Failure and Retry.
select public.publish_slot_start('e2184000-0000-4000-8000-00000000000f', 'e2180000-0000-4000-8000-00000000000a',
  (select id from orders where slot = 'e2184000-0000-4000-8000-00000000000f'));
select public.publish_status('e2184000-0000-4000-8000-00000000000f', 'failed', null, null,
  '{"code":"rate_limited","message":"X asked us to slow down.","retryable":true}');
select is((select status from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000f'), 'failed', 'f: failed');
create temp table fcard as select * from public.approvals
  where ref_kind = 'schedule_slot' and ref_id = 'e2184000-0000-4000-8000-00000000000f' and status = 'waiting';
select is((select snapshot->>'last_error' from fcard), 'X asked us to slow down.', 'a card says why');
select is((select expires_at from fcard), (select window_ends_at from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000f'),
  'and stays open while the window lasts');
grant select on fcard to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2180000-0000-4000-8000-00000000000a"}';
select is((public.approval_decide((select id from fcard), 'retry', jsonb_build_object('content_hash', (select content_hash from fcard)))).status,
  'approved', 'the founder retries');
reset role;
select is((select status from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000f'), 'waiting', 'back to waiting');
select public.schedule_claim_due();
select is((select status from public.schedule_slots where id = 'e2184000-0000-4000-8000-00000000000f'), 'due', 'fired again inside its window');
select is((public.publish_slot_start('e2184000-0000-4000-8000-00000000000f', 'e2180000-0000-4000-8000-00000000000a',
  (select id from orders where slot = 'e2184000-0000-4000-8000-00000000000f' order by id limit 1 offset 0))).attempts >= 1, true,
  'it starts again inside its window');

select ok(not has_function_privilege('authenticated', 'public.schedule_claim_due()', 'execute'), 'only the sweep claims');
select ok(not has_function_privilege('authenticated', 'public.publish_status(uuid,text,text,text,jsonb,text)', 'execute'),
  'only the handler and the webhook report status');
select is(public.work_order_department('publish_post'), 'publish', 'publish_post belongs to Publish');

select * from finish();
rollback;
