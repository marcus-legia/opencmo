-- P4 finish (20261230140000): a post Writer stored under the calendar's label ("Threads") gets its slot; a due slot with no connected account raises its copy-and-open card, which does not
-- expire and starts no publish_post; "I posted it" publishes the founder's own copy-and-open slot (and its post),
-- once, and nothing else.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

insert into auth.users (id, email) values
  ('e2190000-0000-4000-8000-00000000000a', 'p4fin@test.local'),
  ('e2190000-0000-4000-8000-00000000000b', 'p4fin-other@test.local');
update public.profiles set timezone = 'UTC' where id in ('e2190000-0000-4000-8000-00000000000a', 'e2190000-0000-4000-8000-00000000000b');
select public.zernio_profile_save('e2190000-0000-4000-8000-00000000000a', 'prof-fin');
select public.social_account_save('e2190000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-fin-x');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e2191000-0000-4000-8000-00000000000a', 'e2190000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date, 'post_draft', 'Posts', '{}', 'writer', 'done');

-- Two posts kept in review (the event rule proposes nothing by itself): a on LinkedIn with no account, b on X.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2192000-0000-4000-8000-00000000000a', 'e2190000-0000-4000-8000-00000000000a', 'post', 'linkedin', current_date, 'Post a', 'in_review', '{"text":"Post a."}'),
  ('e2192000-0000-4000-8000-00000000000b', 'e2190000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Post b', 'in_review', '{"text":"Post b."}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2193000-0000-4000-8000-00000000000a', 'e2190000-0000-4000-8000-00000000000a', 'e2191000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2192000-0000-4000-8000-00000000000a', 'decided'),
  ('e2193000-0000-4000-8000-00000000000b', 'e2190000-0000-4000-8000-00000000000a', 'e2191000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2192000-0000-4000-8000-00000000000b', 'decided');
insert into public.schedule_slots (id, user_id, deliverable_id, platform, account_id, mode, publish_at, window_ends_at, status) values
  ('e2194000-0000-4000-8000-00000000000a', 'e2190000-0000-4000-8000-00000000000a', 'e2193000-0000-4000-8000-00000000000a', 'linkedin',
    null, 'intent', now() - interval '1 minute', now() + interval '14 minutes', 'waiting'),
  ('e2194000-0000-4000-8000-00000000000b', 'e2190000-0000-4000-8000-00000000000a', 'e2193000-0000-4000-8000-00000000000b', 'x',
    (select id from public.social_accounts where user_id = 'e2190000-0000-4000-8000-00000000000a'), 'publish',
    now() + interval '2 hours', now() + interval '2 hours 15 minutes', 'waiting');
select public.approval_raise(user_id, 'schedule_slot', id) from public.schedule_slots where id::text like 'e2194000-%';
update public.approvals set status = 'approved', decided_at = now() where ref_kind = 'schedule_slot' and ref_id::text like 'e2194000-%';

select public.schedule_claim_due();

select is((select status || ':' || (error->>'code') from public.schedule_slots where id = 'e2194000-0000-4000-8000-00000000000a'),
  'failed:no_account', 'a due slot with no account turns into its copy-and-open card');
select is((select count(*)::int from public.approvals
  where ref_kind = 'schedule_slot' and ref_id = 'e2194000-0000-4000-8000-00000000000a' and status = 'waiting'), 1, 'one card waits for the founder');
select is((select expires_at from public.approvals
  where ref_kind = 'schedule_slot' and ref_id = 'e2194000-0000-4000-8000-00000000000a' and status = 'waiting'), null,
  'the copy-and-open card does not expire');
select is((select count(*)::int from public.work_orders where kind = 'publish_post' and brief->>'slot_id' = 'e2194000-0000-4000-8000-00000000000a'), 0,
  'nothing is ordered to post it');

-- Another founder cannot mark it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2190000-0000-4000-8000-00000000000b"}';
select throws_ok($$select public.schedule_mark_posted('e2194000-0000-4000-8000-00000000000a')$$, 'P0002', 'Slot not found.',
  'another founder''s slot is not found');

set local request.jwt.claims = '{"sub":"e2190000-0000-4000-8000-00000000000a"}';
select throws_ok($$select public.schedule_mark_posted('e2194000-0000-4000-8000-00000000000b')$$, 'P0001',
  'Only a post you copy and post yourself can be marked as posted.', 'a slot that posts through the account is never marked by hand');
select is((select status from public.schedule_mark_posted('e2194000-0000-4000-8000-00000000000a')), 'approved', 'the card closes as approved');
select is((select status from public.schedule_mark_posted('e2194000-0000-4000-8000-00000000000a')), 'approved', 'a second call changes nothing');
reset role;

select is((select status from public.schedule_slots where id = 'e2194000-0000-4000-8000-00000000000a'), 'published', 'the slot is published');
select is((select published_at is not null from public.schedule_slots where id = 'e2194000-0000-4000-8000-00000000000a'), true, 'with its time');
select is((select status from public.content_items where id = 'e2192000-0000-4000-8000-00000000000a'), 'published', 'and the post is published');
select is((select status from public.schedule_slots where id = 'e2194000-0000-4000-8000-00000000000b'), 'waiting', 'the other slot is untouched');

-- A post stored the way Writer stores it (the calendar's label), approved: Schedule proposes it on its platform.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2192000-0000-4000-8000-00000000000c', 'e2190000-0000-4000-8000-00000000000a', 'post', 'Threads', current_date, 'Post c', 'in_review', '{"text":"Post c."}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2193000-0000-4000-8000-00000000000c', 'e2190000-0000-4000-8000-00000000000a', 'e2191000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2192000-0000-4000-8000-00000000000c', 'waiting_founder');
update public.content_items set status = 'approved' where id = 'e2192000-0000-4000-8000-00000000000c';
update public.deliverables set status = 'decided' where id = 'e2193000-0000-4000-8000-00000000000c';
select is((select platform || ':' || mode || ':' || status from public.schedule_slots where deliverable_id = 'e2193000-0000-4000-8000-00000000000c'),
  'threads:intent:proposed', 'a "Threads" post gets a Threads slot (copy and open: no Threads account)');

select * from finish();
rollback;
