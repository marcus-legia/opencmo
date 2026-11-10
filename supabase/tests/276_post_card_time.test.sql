-- cmo-review-3 1.2 (20270113010000): a post card carries its time. The proposal is part of the hash; approving it makes
-- the slot `waiting` at that time with no schedule card; a time that is gone falls back to one schedule card that says
-- so; a changed time is a new card; another founder's card is not found; "I posted it" schedules nothing.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(24);

select ok(not has_function_privilege('authenticated', 'public.schedule_take_proposal(public.deliverables,text)', 'execute'), 'the slot rule is internal');
select ok(not has_function_privilege('authenticated', 'public.post_change_proposal(public.approvals,text,jsonb)', 'execute'), 'the change goes through approval_decide');

insert into auth.users (id, email) values
  ('e2760000-0000-4000-8000-00000000000a', 'time-a@test.local'),
  ('e2760000-0000-4000-8000-00000000000b', 'time-b@test.local');
update public.profiles set timezone = 'UTC' where id = 'e2760000-0000-4000-8000-00000000000a';
select public.zernio_profile_save('e2760000-0000-4000-8000-00000000000a', 'prof-time');
select public.social_account_save('e2760000-0000-4000-8000-00000000000a', 'threads', '@founder', null, 'acc-time-threads');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e2761000-0000-4000-8000-00000000000a', 'e2760000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'done');

-- Threads (connected), two X posts (no X account) and one more Threads post, each waiting on its card.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2762000-0000-4000-8000-00000000000a', 'e2760000-0000-4000-8000-00000000000a', 'post', 'Threads', current_date, 'Threads', 'in_review',
   '{"text":"Goes out from the account."}'),
  ('e2762000-0000-4000-8000-00000000000b', 'e2760000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'X one', 'in_review',
   '{"text":"First X post."}'),
  ('e2762000-0000-4000-8000-00000000000c', 'e2760000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'X two', 'in_review',
   '{"text":"Second X post."}'),
  ('e2762000-0000-4000-8000-00000000000d', 'e2760000-0000-4000-8000-00000000000a', 'post', 'Threads', current_date, 'Gone', 'in_review',
   '{"text":"Its time will be taken."}');
insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
select 'e2760000-0000-4000-8000-00000000000a', 'e2761000-0000-4000-8000-00000000000a', 'post', 'content_item', id, 'waiting_founder'
from public.content_items where user_id = 'e2760000-0000-4000-8000-00000000000a';

create temp table t_card on commit drop as
select c.idea as name, a.id, a.content_hash as hash, c.id as item, a.snapshot
from public.approvals a join public.content_items c on c.id = a.ref_id
where a.ref_kind = 'content_item' and a.status = 'waiting' and c.user_id = 'e2760000-0000-4000-8000-00000000000a';
grant select on t_card to authenticated;

select is((select snapshot->'proposed'->>'mode' from t_card where name = 'Threads'), 'publish', 'a connected platform posts from the account');
select is((select snapshot->'proposed'->>'handle' from t_card where name = 'Threads'), '@founder', 'the card names the account');
select is((select snapshot->'proposed'->>'mode' from t_card where name = 'X one'), 'intent', 'without an account, the founder posts it');
select ok((select (snapshot->'proposed'->>'at')::timestamptz > now() from t_card where name = 'X one'), 'the time is ahead');
select isnt((select snapshot->'proposed'->>'at' from t_card where name = 'X one'), (select snapshot->'proposed'->>'at' from t_card where name = 'X two'),
  'two cards waiting side by side do not promise the same time');
select is((select snapshot->'proposed' from t_card where name = 'Threads'),
  public.post_proposal_snapshot('e2760000-0000-4000-8000-00000000000a', (select body from public.content_items where id = 'e2762000-0000-4000-8000-00000000000a')),
  'the snapshot holds the proposal the post stores');

-- A redraft that writes a whole new body keeps the time the card shows; a null drops it.
update public.content_items set body = '{"text":"Second X post, redrafted."}' where id = 'e2762000-0000-4000-8000-00000000000c';
select is((select body->'proposed'->>'at' from public.content_items where id = 'e2762000-0000-4000-8000-00000000000c'),
  (select snapshot->'proposed'->>'at' from t_card where name = 'X two'), 'a redraft keeps the time');
update public.content_items set body = '{"text":"Second X post.","proposed":null}' where id = 'e2762000-0000-4000-8000-00000000000c';
select ok((select not (body ? 'proposed') from public.content_items where id = 'e2762000-0000-4000-8000-00000000000c'), 'a null drops it');
update public.content_items set body = jsonb_build_object('text', 'Second X post.', 'proposed', (select snapshot->'proposed' from t_card where name = 'X two') - 'handle')
where id = 'e2762000-0000-4000-8000-00000000000c';
delete from t_card where name = 'X two';
insert into t_card select c.idea, a.id, a.content_hash, c.id, a.snapshot from public.approvals a join public.content_items c on c.id = a.ref_id
where a.ref_kind = 'content_item' and a.status = 'waiting' and c.id = 'e2762000-0000-4000-8000-00000000000c';

-- Another founder cannot change or approve the card.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2760000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok(format($$ select public.approval_decide(%L, 'change_time', %L) $$, (select id from t_card where name = 'X one'),
  jsonb_build_object('content_hash', (select hash from t_card where name = 'X one'), 'publish_at', to_char(now() + interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
  'P0002', 'Card not found.', 'another founder''s card is not found');

set local request.jwt.claims = '{"sub":"e2760000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.approval_decide(%L, 'change_time', %L) $$, (select id from t_card where name = 'X one'),
  jsonb_build_object('content_hash', (select hash from t_card where name = 'X one'), 'publish_at', to_char(now() + interval '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
  '22023', 'Pick a time between five minutes and 60 days from now.', 'a time too soon is refused');

-- Approving the Threads post approves its time: the slot waits at it, approved, and no schedule card asks.
select is((public.approval_decide((select id from t_card where name = 'Threads'), 'approve',
  jsonb_build_object('content_hash', (select hash from t_card where name = 'Threads')))).status, 'approved', 'the post is approved');
reset role;
create temp table t_slot on commit drop as
select s.* from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
where d.ref_id = 'e2762000-0000-4000-8000-00000000000a';
select is((select count(*)::int from t_slot), 1, 'one slot');
select is((select status from t_slot), 'waiting', 'it waits for its time');
select is((select to_char(publish_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from t_slot),
  (select snapshot->'proposed'->>'at' from t_card where name = 'Threads'), 'at the time the card showed');
select is((select count(*)::int from public.approvals where ref_kind = 'schedule_slot' and ref_id = (select id from t_slot) and status in ('waiting', 'held')),
  0, 'no schedule card is raised');
select ok(public.schedule_approval_holds((select s from public.schedule_slots s where s.id = (select id from t_slot))),
  'the firing finds the founder''s approval');

-- A changed time is a new card: the old one can no longer be approved.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2760000-0000-4000-8000-00000000000a","role":"authenticated"}';
create temp table t_new on commit drop as
select * from public.approval_decide((select id from t_card where name = 'X one'), 'change_time',
  jsonb_build_object('content_hash', (select hash from t_card where name = 'X one'), 'publish_at', to_char(date_trunc('hour', now()) + interval '10 days 14 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
select isnt((select content_hash from t_new), (select hash from t_card where name = 'X one'), 'the new time changes the hash');
select is((select snapshot->'proposed'->>'at' from t_new), to_char(date_trunc('hour', now()) + interval '10 days 14 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'the new card shows the new time');
select throws_ok(format($$ select public.approval_decide(%L, 'approve', %L) $$, (select id from t_card where name = 'X one'),
  jsonb_build_object('content_hash', (select hash from t_card where name = 'X one'))),
  'P0001', null, 'the old card is refused');

-- A time taken in the meantime (another post went to the same hour): one schedule card asks for a new time.
reset role;
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
values ('e2763000-0000-4000-8000-00000000000a', 'e2760000-0000-4000-8000-00000000000a', 'e2761000-0000-4000-8000-00000000000a',
  'post', 'content_item', 'e2762000-0000-4000-8000-0000000000ff', 'decided');
insert into public.schedule_slots (user_id, deliverable_id, platform, account_id, mode, publish_at, window_ends_at, status)
select 'e2760000-0000-4000-8000-00000000000a', 'e2763000-0000-4000-8000-00000000000a', 'threads', null, 'intent',
  (snapshot->'proposed'->>'at')::timestamptz, (snapshot->'proposed'->>'at')::timestamptz + interval '15 minutes', 'waiting'
from t_card where name = 'Gone';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2760000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.approval_decide((select id from t_card where name = 'Gone'), 'approve', jsonb_build_object('content_hash', (select hash from t_card where name = 'Gone')));
reset role;
select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id join public.deliverables d on d.id = s.deliverable_id
  where a.ref_kind = 'schedule_slot' and a.status = 'waiting' and d.ref_id = 'e2762000-0000-4000-8000-00000000000d'), 1, 'one schedule card asks');
select is((select a.snapshot->>'last_error' from public.approvals a join public.schedule_slots s on s.id = a.ref_id join public.deliverables d on d.id = s.deliverable_id
  where a.ref_kind = 'schedule_slot' and a.status = 'waiting' and d.ref_id = 'e2762000-0000-4000-8000-00000000000d'),
  'The time you approved is no longer free. Pick a new one.', 'and says why');

-- "I posted it" on the second X post: nothing is scheduled for it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2760000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_post_myself((select id from t_card where name = 'X two'), (select hash from t_card where name = 'X two'));
reset role;
select is((select count(*)::int from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
  where d.ref_id = 'e2762000-0000-4000-8000-00000000000c' and s.status <> 'cancelled'), 0, 'a post marked posted gets no time');

select * from finish();
rollback;
