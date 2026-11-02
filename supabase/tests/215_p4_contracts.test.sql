-- P4 A0 (20261230090000): accounts are written only by the service role after Zernio confirms them; a schedule card
-- shows content, time, account and platform fields, expires at its time, and changes when any of them changes.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(29);

-- Grants and RLS.
select ok(not has_table_privilege('anon', 'public.social_accounts', 'select'), 'anon reads no accounts');
select ok(not has_table_privilege('authenticated', 'public.social_accounts', 'insert'), 'a founder does not insert accounts');
select ok(not has_table_privilege('authenticated', 'public.schedule_slots', 'update'), 'a founder does not write slots');
select ok(not has_table_privilege('authenticated', 'public.zernio_receipts', 'select'), 'receipts are the webhook''s');
select ok(not has_function_privilege('authenticated', 'public.social_account_save(uuid,text,text,text,text)', 'execute'),
  'a founder cannot name an account id: only the callback route saves one');
select ok(not has_function_privilege('authenticated', 'public.zernio_profile_save(uuid,text)', 'execute'),
  'nor a Zernio profile');
select ok(has_function_privilege('authenticated', 'public.social_account_remove(uuid)', 'execute'), 'a founder disconnects');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.zernio_profiles'::regclass,
  'public.social_accounts'::regclass, 'public.schedule_slots'::regclass, 'public.zernio_receipts'::regclass)), 'RLS on all four');

insert into auth.users (id, email) values
  ('e2150000-0000-4000-8000-00000000000a', 'p4a0@test.local'),
  ('e2150000-0000-4000-8000-00000000000b', 'p4a0-other@test.local');

-- Accounts.
select throws_ok($$ select public.social_account_save('e2150000-0000-4000-8000-00000000000a', 'x', 'founder', null, 'acc-x') $$,
  'P0001', 'Connect starts with a Zernio profile.', 'an account hangs off a Zernio profile');
select public.zernio_profile_save('e2150000-0000-4000-8000-00000000000a', 'prof-a');
select lives_ok($$ select public.zernio_profile_save('e2150000-0000-4000-8000-00000000000a', 'prof-a') $$, 'saving the same profile again is fine');
select throws_ok($$ select public.zernio_profile_save('e2150000-0000-4000-8000-00000000000a', 'prof-other') $$,
  'P0001', null, 'a founder has one Zernio profile');
select is((public.social_account_save('e2150000-0000-4000-8000-00000000000a', 'x', ' founder ', 'https://img/a.png', 'acc-x')).handle,
  'founder', 'an account is saved with its handle');
select is((public.social_account_save('e2150000-0000-4000-8000-00000000000a', 'x', 'renamed', null, 'acc-x')).handle,
  'renamed', 'reconnecting the same platform updates the one account');
select is((select count(*)::int from public.social_accounts where user_id = 'e2150000-0000-4000-8000-00000000000a'), 1,
  'one account per platform');
select throws_ok($$ select public.social_account_save('e2150000-0000-4000-8000-00000000000a', 'reddit', 'r', null, 'acc-r') $$,
  '23514', null, 'Reddit is never posted to');

-- A deliverable to schedule: an X post, kept in review so the event rule (A3) proposes nothing by itself.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2151000-0000-4000-8000-00000000000a', 'e2150000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Launch',
   'in_review', '{"text":"We shipped cut by words."}');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e2152000-0000-4000-8000-00000000000a', 'e2150000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Post', '{}', 'writer', 'done');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2153000-0000-4000-8000-00000000000a', 'e2150000-0000-4000-8000-00000000000a', 'e2152000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e2151000-0000-4000-8000-00000000000a', 'decided');

insert into public.schedule_slots (id, user_id, deliverable_id, platform, account_id, publish_at, window_ends_at, options)
select 'e2154000-0000-4000-8000-00000000000a', 'e2150000-0000-4000-8000-00000000000a', 'e2153000-0000-4000-8000-00000000000a',
  'x', a.id, '2030-01-07 09:00:00+00', '2030-01-07 09:20:00+00', '{"ai_label": false}'
from public.social_accounts a where a.zernio_account_id = 'acc-x';

select throws_ok($$ insert into public.schedule_slots (user_id, deliverable_id, platform, publish_at, window_ends_at)
  values ('e2150000-0000-4000-8000-00000000000a', 'e2153000-0000-4000-8000-00000000000a', 'x', '2030-01-08 09:00+00', '2030-01-08 09:20+00') $$,
  '23505', null, 'never twice: one live slot per deliverable and platform');
select throws_ok($$ insert into public.schedule_slots (user_id, deliverable_id, platform, publish_at, window_ends_at)
  values ('e2150000-0000-4000-8000-00000000000a', 'e2153000-0000-4000-8000-00000000000a', 'threads', '2030-01-08 09:00+00', '2030-01-08 09:00+00') $$,
  '23514', null, 'a window ends after its time');
select throws_ok($$ update public.schedule_slots set jitter_seconds = 600 where id = 'e2154000-0000-4000-8000-00000000000a' $$,
  '23514', null, 'jitter stays within four minutes');

-- The card.
select public.approval_raise('e2150000-0000-4000-8000-00000000000a', 'schedule_slot', 'e2154000-0000-4000-8000-00000000000a');
select is((select kind || '/' || department from public.approvals where ref_id = 'e2154000-0000-4000-8000-00000000000a'),
  'schedule/schedule', 'a schedule card from Schedule');
select is((select expires_at from public.approvals where ref_id = 'e2154000-0000-4000-8000-00000000000a'),
  '2030-01-07 09:00:00+00'::timestamptz, 'it expires at its time');
select is((select account || ' ' || (post_at = expires_at)::text from public.approvals where ref_id = 'e2154000-0000-4000-8000-00000000000a'),
  'renamed true', 'its foot shows the account and the time');
select is((select snapshot->>'text' || ' · ' || (snapshot->>'publish_at') from public.approvals where ref_id = 'e2154000-0000-4000-8000-00000000000a'),
  'We shipped cut by words. · 2030-01-07T09:00:00Z', 'the snapshot holds the words and the UTC time');

create temp table first_hash as select content_hash from public.approvals where ref_id = 'e2154000-0000-4000-8000-00000000000a';
update public.content_items set body = '{"text":"We shipped cut by words!"}' where id = 'e2151000-0000-4000-8000-00000000000a';
select isnt(public.approval_hash(public.approval_snapshot('schedule_slot', 'e2154000-0000-4000-8000-00000000000a')),
  (select content_hash from first_hash), 'editing the words changes what the card approves');
update public.content_items set body = '{"text":"We shipped cut by words."}' where id = 'e2151000-0000-4000-8000-00000000000a';
update public.schedule_slots set options = '{"ai_label": true}' where id = 'e2154000-0000-4000-8000-00000000000a';
select isnt(public.approval_hash(public.approval_snapshot('schedule_slot', 'e2154000-0000-4000-8000-00000000000a')),
  (select content_hash from first_hash), 'so does a platform field');
update public.schedule_slots set options = '{"ai_label": false}', jitter_seconds = 120 where id = 'e2154000-0000-4000-8000-00000000000a';
select is(public.approval_hash(public.approval_snapshot('schedule_slot', 'e2154000-0000-4000-8000-00000000000a')),
  (select content_hash from first_hash), 'jitter is not part of what is approved');

-- Disconnect.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2150000-0000-4000-8000-00000000000b"}';
select throws_ok($$ select public.social_account_remove((select id from public.social_accounts where zernio_account_id = 'acc-x')) $$,
  'P0002', null, 'another founder cannot disconnect it');
set local request.jwt.claims = '{"sub":"e2150000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.social_account_remove((select id from public.social_accounts where zernio_account_id = 'acc-x')) $$,
  'the founder disconnects it');
reset role;
select is((select account_id from public.schedule_slots where id = 'e2154000-0000-4000-8000-00000000000a'), null,
  'its slot loses the account, so its card no longer matches');

-- Receipts.
insert into public.zernio_receipts (event_id) values ('evt_1');
select throws_ok($$ insert into public.zernio_receipts (event_id) values ('evt_1') $$, '23505', null, 'a replayed event is refused');

select * from finish();
rollback;
