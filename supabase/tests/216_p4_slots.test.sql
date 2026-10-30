-- P4 A1 (20261230100000): an approved deliverable gets a proposed slot per platform with its card; the founder
-- approves, moves, changes the account or the platform fields, or cancels. Gap, daily cap and the short's own long
-- video hold; a card is decided only as it was seen.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(41);

select is((public.schedule_rules()->'platforms'->'x'->>'dailyCap')::int, 5, 'X keeps five a day');
select is((public.schedule_rules()->>'minGapHours')::int, 3, 'three hours between two posts on one platform');

insert into auth.users (id, email) values
  ('e2160000-0000-4000-8000-00000000000a', 'p4a1@test.local'),
  ('e2160000-0000-4000-8000-00000000000b', 'p4a1-other@test.local');
update public.profiles set timezone = 'UTC' where id = 'e2160000-0000-4000-8000-00000000000a';
select public.zernio_profile_save('e2160000-0000-4000-8000-00000000000a', 'prof-a1');
select public.social_account_save('e2160000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-a1-x');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e2161000-0000-4000-8000-00000000000a', 'e2160000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'done');

-- Posts: two on X, one on Threads, and one still in review.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2162000-0000-4000-8000-00000000000a', 'e2160000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'One', 'approved', '{"text":"First post."}'),
  ('e2162000-0000-4000-8000-00000000000b', 'e2160000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Two', 'approved', '{"text":"Second post."}'),
  ('e2162000-0000-4000-8000-00000000000c', 'e2160000-0000-4000-8000-00000000000a', 'post', 'threads', current_date, 'Three', 'approved', '{"text":"Third post."}'),
  ('e2162000-0000-4000-8000-00000000000d', 'e2160000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Four', 'in_review', '{"text":"Not yet."}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2163000-0000-4000-8000-00000000000a', 'e2160000-0000-4000-8000-00000000000a', 'e2161000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2162000-0000-4000-8000-00000000000a', 'decided'),
  ('e2163000-0000-4000-8000-00000000000b', 'e2160000-0000-4000-8000-00000000000a', 'e2161000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2162000-0000-4000-8000-00000000000b', 'decided'),
  ('e2163000-0000-4000-8000-00000000000c', 'e2160000-0000-4000-8000-00000000000a', 'e2161000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2162000-0000-4000-8000-00000000000c', 'decided'),
  ('e2163000-0000-4000-8000-00000000000d', 'e2160000-0000-4000-8000-00000000000a', 'e2161000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2162000-0000-4000-8000-00000000000d', 'waiting_founder');

-- Proposing.
select is(public.schedule_propose('e2163000-0000-4000-8000-00000000000a'), 1, 'an approved post gets one slot');
select is(public.schedule_propose('e2163000-0000-4000-8000-00000000000a'), 0, 'proposing again changes nothing');
select is(public.schedule_propose('e2163000-0000-4000-8000-00000000000d'), 0, 'a post still in review gets none');

create temp view s1 as select * from public.schedule_slots where deliverable_id = 'e2163000-0000-4000-8000-00000000000a';
select is((select status || '/' || mode from s1), 'proposed/publish', 'proposed, from the connected account');
select is((select to_char(publish_at at time zone 'UTC', 'HH24:MI') from s1), '09:00', 'at X''s default slot in the founder''s time');
select ok((select publish_at >= now() + interval '30 minutes' from s1), 'never sooner than the lead time');
select ok((select jitter_seconds between -240 and 240 and window_ends_at = publish_at + interval '15 minutes' from s1),
  'with natural jitter and a fifteen-minute window');
select is((select a.id from public.approvals a where a.ref_kind = 'schedule_slot' and a.ref_id = (select id from s1) and a.status = 'waiting'),
  (select approval_id from s1), 'the slot knows its card');
select is((select expires_at from public.approvals where id = (select approval_id from s1)), (select publish_at from s1),
  'the card expires at its time');

select public.schedule_propose('e2163000-0000-4000-8000-00000000000b');
select ok((select abs(extract(epoch from (b.publish_at - a.publish_at))) >= 3 * 3600
  from public.schedule_slots a, public.schedule_slots b
  where a.deliverable_id = 'e2163000-0000-4000-8000-00000000000a' and b.deliverable_id = 'e2163000-0000-4000-8000-00000000000b'),
  'a second X post keeps three hours from the first');

select public.schedule_propose('e2163000-0000-4000-8000-00000000000c');
select is((select mode || ' ' || coalesce(account_id::text, 'none') from public.schedule_slots where deliverable_id = 'e2163000-0000-4000-8000-00000000000c'),
  'intent none', 'no Threads account: copy and open');

-- A short and its long video are not on one platform the same day.
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2164000-0000-4000-8000-00000000000a', 'e2160000-0000-4000-8000-00000000000a', 'https://a', 60, 'done');
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, kind) values
  ('e2165000-0000-4000-8000-00000000000a', 'e2164000-0000-4000-8000-00000000000a', -1, 'Long', 0, 0, 'blank');
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, kind, parent_clip_id) values
  ('e2165000-0000-4000-8000-00000000000b', 'e2164000-0000-4000-8000-00000000000a', -2, 'Short', 0, 0, 'short', 'e2165000-0000-4000-8000-00000000000a');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2163000-0000-4000-8000-00000000000e', 'e2160000-0000-4000-8000-00000000000a', 'e2161000-0000-4000-8000-00000000000a', 'video', 'clip', 'e2165000-0000-4000-8000-00000000000a', 'decided'),
  ('e2163000-0000-4000-8000-00000000000f', 'e2160000-0000-4000-8000-00000000000a', 'e2161000-0000-4000-8000-00000000000a', 'short', 'clip', 'e2165000-0000-4000-8000-00000000000b', 'ready');
select is(public.schedule_propose('e2163000-0000-4000-8000-00000000000f'), 0, 'a short without a caption is not proposed');
insert into public.content_items (id, user_id, department, platform, day, idea, status, clip_id, body) values
  ('e2162000-0000-4000-8000-00000000000e', 'e2160000-0000-4000-8000-00000000000a', 'video', 'tiktok_caption', current_date,
   'Caption', 'approved', 'e2165000-0000-4000-8000-00000000000b', '{"text":"Cut by words"}');
create temp table first_pick as select public.schedule_pick_time('e2160000-0000-4000-8000-00000000000a', 'tiktok',
  'e2163000-0000-4000-8000-00000000000f') as at;
-- The long video takes TikTok that day, four hours after the short's first pick.
insert into public.schedule_slots (user_id, deliverable_id, platform, publish_at, window_ends_at)
select 'e2160000-0000-4000-8000-00000000000a', 'e2163000-0000-4000-8000-00000000000e', 'tiktok',
  at + interval '4 hours', at + interval '4 hours 15 minutes' from first_pick;
select is(public.schedule_propose('e2163000-0000-4000-8000-00000000000f'), 1, 'a short goes where it has a caption');
select isnt((select (publish_at at time zone 'UTC')::date from public.schedule_slots where deliverable_id = 'e2163000-0000-4000-8000-00000000000f'),
  (select (at at time zone 'UTC')::date from first_pick), 'not the day of its own long video');
select is((select snapshot->>'text' from public.approvals where ref_id = (select id from public.schedule_slots
  where deliverable_id = 'e2163000-0000-4000-8000-00000000000f') and status = 'waiting'), 'Cut by words',
  'its card shows the caption for that platform');

-- Deciding. As the founder.
create temp table ids as select
  (select id from s1) as x_slot,
  (select approval_id from s1) as x_card,
  (select id from public.schedule_slots where deliverable_id = 'e2163000-0000-4000-8000-00000000000f') as t_slot;
grant select on ids, s1 to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2160000-0000-4000-8000-00000000000a"}';

select throws_ok($$ select public.approval_decide((select x_card from ids), 'approve', '{"content_hash":"0000000000000000000000000000000000000000000000000000000000000000"}') $$,
  'P0001', 'This card changed. Look at it again before deciding.', 'a stale card is refused');
select is((public.approval_decide((select x_card from ids), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = (select x_card from ids))))).status,
  'approved', 'the founder approves the time');
select is((select status from public.schedule_slots where id = (select x_slot from ids)), 'waiting', 'the slot waits for its time');

select throws_ok($$ select public.schedule_change((select x_slot from ids), 'change_time', '{"publish_at":"2001-01-01T09:00:00Z"}') $$,
  '22023', null, 'a time in the past is refused');
select throws_ok($$ select public.schedule_change((select x_slot from ids), 'change_time', '{"publish_at":"2030-01-01 09:00"}') $$,
  '22023', 'Pick a time, with its time zone.', 'a time without its zone is refused');
create temp table moved as select * from public.schedule_change((select x_slot from ids), 'change_time',
  jsonb_build_object('publish_at', to_char((now() + interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:00:00"Z"')));
select is((select status from moved), 'waiting', 'moving an approved slot raises a new card');
select is((select status from public.schedule_slots where id = (select x_slot from ids)), 'proposed', 'and the slot asks again');
select is((select status from public.approvals where id = (select x_card from ids)), 'approved', 'the old approval stays on record');
select is((select approval_id from public.schedule_slots where id = (select x_slot from ids)), (select id from moved),
  'but the slot now follows the new card');

select throws_ok($$ select public.schedule_change((select x_slot from ids), 'set_options', '{"options":{"privacy":"SELF_ONLY"}}') $$,
  '22023', 'That setting is only for TikTok.', 'TikTok''s fields stay on TikTok');
select is((select snapshot->'options'->>'ai_label' from public.schedule_change((select x_slot from ids), 'set_options', '{"options":{"ai_label":true}}')),
  'true', 'the AI-generated label is the founder''s toggle');

-- TikTok: an account and its required fields first.
select throws_ok($$ select public.approval_decide((select approval_id from public.schedule_slots where id = (select t_slot from ids)), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = (select approval_id from public.schedule_slots where id = (select t_slot from ids))))) $$,
  'P0001', 'Connect your TikTok account to post this.', 'no TikTok account: nothing to post from');
reset role;
select public.social_account_save('e2160000-0000-4000-8000-00000000000a', 'tiktok', '@founder', null, 'acc-a1-tt');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2160000-0000-4000-8000-00000000000a"}';
select is((select mode from public.schedule_slots where id = (select t_slot from ids)), 'intent', 'connecting does not change a slot by itself');
select is((select snapshot->>'handle' from public.schedule_change((select t_slot from ids), 'change_account',
  jsonb_build_object('account_id', (select id from public.social_accounts where zernio_account_id = 'acc-a1-tt')))), '@founder',
  'the founder picks the account');
select throws_ok($$ select public.approval_decide((select approval_id from public.schedule_slots where id = (select t_slot from ids)), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = (select approval_id from public.schedule_slots where id = (select t_slot from ids))))) $$,
  'P0001', 'Choose who can see it on TikTok and whether people can comment.', 'TikTok''s fields have no default');
select throws_ok($$ select public.schedule_change((select t_slot from ids), 'set_options', '{"options":{"privacy":"EVERYONE"}}') $$,
  '22023', 'Choose who can see it from TikTok''s list.', 'privacy comes from TikTok''s list');
select public.schedule_change((select t_slot from ids), 'set_options', '{"options":{"privacy":"PUBLIC_TO_EVERYONE","allow_comment":true}}');
select is((public.approval_decide((select approval_id from public.schedule_slots where id = (select t_slot from ids)), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = (select approval_id from public.schedule_slots where id = (select t_slot from ids)))))).status,
  'approved', 'with them, the short is approved');
select throws_ok($$ select public.schedule_change((select t_slot from ids), 'change_account', '{"account_id":"e2160000-0000-4000-8000-00000000000b"}') $$,
  '22023', null, 'only the founder''s own account on that platform');

-- Cancel, and another founder.
select is((public.approval_decide((select approval_id from public.schedule_slots where id = (select x_slot from ids)), 'cancel',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = (select approval_id from public.schedule_slots where id = (select x_slot from ids)))))).status,
  'skipped', 'cancel skips the card');
select is((select status from public.schedule_slots where id = (select x_slot from ids)), 'cancelled', 'and drops the slot');
select throws_ok($$ select public.schedule_change((select x_slot from ids), 'change_time', '{"publish_at":"2030-01-01T09:00:00Z"}') $$,
  'P0001', 'This post is already on its way.', 'a cancelled slot is not moved');

set local request.jwt.claims = '{"sub":"e2160000-0000-4000-8000-00000000000b"}';
select throws_ok($$ select public.schedule_change((select t_slot from ids), 'cancel', '{}') $$, 'P0002', null, 'another founder cannot touch it');
reset role;

-- The daily cap holds for a time the founder picks.
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
select ('e2166000-0000-4000-8000-00000000000' || i)::uuid, 'e2160000-0000-4000-8000-00000000000a', 'e2161000-0000-4000-8000-00000000000a',
  'post', 'content_item', ('e2167000-0000-4000-8000-00000000000' || i)::uuid, 'decided'
from generate_series(1, 5) i;
insert into public.schedule_slots (user_id, deliverable_id, platform, publish_at, window_ends_at)
select 'e2160000-0000-4000-8000-00000000000a', ('e2166000-0000-4000-8000-00000000000' || i)::uuid, 'x',
  date_trunc('day', now() + interval '10 days') + make_interval(hours => i), date_trunc('day', now() + interval '10 days') + make_interval(hours => i, mins => 15)
from generate_series(1, 5) i;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2160000-0000-4000-8000-00000000000a"}';
select throws_ok($$ select public.schedule_change((select id from public.schedule_slots where deliverable_id = 'e2163000-0000-4000-8000-00000000000b'),
  'change_time', jsonb_build_object('publish_at', to_char(date_trunc('day', now() + interval '10 days') + interval '20 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) $$,
  'P0001', 'That day already has 5 posts on X.', 'X''s five a day hold for a time the founder picks');
reset role;

select ok(not has_function_privilege('authenticated', 'public.schedule_propose(uuid)', 'execute'), 'only rules propose');

select * from finish();
rollback;
