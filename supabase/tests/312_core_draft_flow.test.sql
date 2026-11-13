-- The daily core draft end to end (core-drafts follow-ups, Task 1): the founder's plan → the week's item and its three
-- targets → one draft and one card → approve once → three slots → every platform posted. Each step was tested on its
-- own (299, 300, 302, 308); this file walks them in the order a founder meets them, through the same functions the
-- app and the runner call. No migration of its own.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(30);

-- Founder A: X and Threads connected, LinkedIn not. Founder B: no account at all.
insert into auth.users (id, email) values
  ('e3120000-0000-4000-8000-00000000000a', 'flow-a@test.local'),
  ('e3120000-0000-4000-8000-00000000000b', 'flow-b@test.local');
update public.profiles set plan = 'starter', credit_balance = 20, timezone = 'UTC'
where id in ('e3120000-0000-4000-8000-00000000000a', 'e3120000-0000-4000-8000-00000000000b');
select public.zernio_profile_save('e3120000-0000-4000-8000-00000000000a', 'prof-flow');
select public.social_account_save('e3120000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-flow-x');
select public.social_account_save('e3120000-0000-4000-8000-00000000000a', 'threads', '@founder', null, 'acc-flow-th');

-- The week plan as the runner writes it (`toPlanItems`, checked in jobs.check.ts): today's slot already for the three
-- platforms, tomorrow's from before the founder changed the plan.
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e3121000-0000-4000-8000-00000000000a', 'e3120000-0000-4000-8000-00000000000a', 'plan_week', 'running'),
  ('e3121000-0000-4000-8000-00000000000b', 'e3120000-0000-4000-8000-00000000000b', 'plan_week', 'running');
select is(public.cmo_plan_week('e3120000-0000-4000-8000-00000000000a', 'e3121000-0000-4000-8000-00000000000a', jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('x', 'threads', 'linkedin'), 'slot', 0,
    'day', current_date, 'idea', 'Today', 'reason', 'r'),
  jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('x'), 'slot', 0,
    'day', current_date + 1, 'idea', 'Tomorrow', 'reason', 'r'))), 2, 'the week plan writes two items');

-- 1. The planner: X 1, Threads 1, LinkedIn 1, saved by the founder.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3120000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.save_posting_plan('{"text":{"x":1,"threads":1,"linkedin":1,"facebook":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  'the founder saves X 1, Threads 1, LinkedIn 1');
reset role;

create function pg_temp.item(p_user uuid, p_idea text) returns uuid language sql as $$
  select id from public.content_items where user_id = p_user and idea = p_idea;
$$;
create function pg_temp.slot(p_item uuid, p_platform text) returns public.schedule_slots language sql as $$
  select s.* from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
  where d.ref_id = p_item and s.platform = p_platform order by s.created_at desc limit 1;
$$;
create function pg_temp.slots(p_item uuid) returns text language sql as $$
  select string_agg(s.platform || ' ' || s.mode || ' ' || s.status, ', ' order by s.platform) from public.schedule_slots s
  join public.deliverables d on d.id = s.deliverable_id where d.ref_id = p_item;
$$;
-- The founder's schedule cards still waiting for this post, by platform.
create function pg_temp.waiting_cards(p_item uuid) returns text language sql as $$
  select coalesce(string_agg(s.platform, ', ' order by s.platform), '') from public.approvals a
  join public.schedule_slots s on s.id = a.ref_id join public.deliverables d on d.id = s.deliverable_id
  where a.ref_kind = 'schedule_slot' and a.status = 'waiting' and d.ref_id = p_item;
$$;
-- The cron's draft for a day's item, as the runner does it: a post_draft run writes the draft and finishes.
create function pg_temp.draft(p_user uuid, p_run uuid, p_item uuid, p_text text) returns void language plpgsql as $$
begin
  insert into public.cmo_runs (id, user_id, kind, status, input)
  values (p_run, p_user, 'post_draft', 'running', jsonb_build_object('item_id', p_item));
  perform public.cmo_save_draft(p_user, p_run, p_item, null, jsonb_build_object('text', p_text, 'targets', jsonb_build_array('x')));
  update public.cmo_runs set status = 'done', finished_at = now() where id = p_run;
end;
$$;
-- A card decided by the founder, with the hash the app sends.
create function pg_temp.decide(p_card uuid, p_action text) returns text language plpgsql as $$
declare
  v_status text;
begin
  set local role authenticated;
  select status into v_status from public.approval_decide(p_card, p_action,
    jsonb_build_object('content_hash', (select content_hash from public.approvals where id = p_card)));
  reset role;
  return v_status;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

select is((select body->'targets' from public.content_items where id = pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')),
  '["x", "threads", "linkedin"]'::jsonb, 'today''s item targets the three platforms');
select is((select platform || ' ' || (body->>'targets') from public.content_items where id = pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Tomorrow')),
  'X ["x", "threads", "linkedin"]', 'saving the plan retargets tomorrow''s item to the three platforms');

-- 2. One draft, one card. The model's own targets are not taken: the planner's stay.
select pg_temp.draft('e3120000-0000-4000-8000-00000000000a', 'e3121000-0000-4000-8000-00000000000c',
  pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'One core post for every platform of the day.');
select is((select status || ' ' || (body->>'targets') from public.content_items where id = pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')),
  'in_review ["x", "threads", "linkedin"]', 'the draft is in review and keeps the three targets');
select is((select count(*)::int from public.approvals where user_id = 'e3120000-0000-4000-8000-00000000000a' and kind = 'post'), 1,
  'one post card, not one a platform');
select is((select ref_id from public.approvals where user_id = 'e3120000-0000-4000-8000-00000000000a' and kind = 'post' and status = 'waiting'),
  pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'the card is today''s item');
select is((select snapshot->'proposed'->>'platform' || ' ' || (snapshot->'proposed'->>'mode') from public.approvals
  where user_id = 'e3120000-0000-4000-8000-00000000000a' and kind = 'post'), 'x publish', 'the card proposes a time on X, its first platform');
select is((select status from public.deliverables where ref_id = pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')),
  'waiting_founder', 'the finished run leaves the post waiting on the founder');
select is((select count(*)::int from public.schedule_slots where user_id = 'e3120000-0000-4000-8000-00000000000a'), 0,
  'nothing is scheduled before the founder approves');

-- 3. Approve once: three slots. X rides on the post card's time; Threads and LinkedIn each get a schedule card.
select is(pg_temp.decide((select id from public.approvals where user_id = 'e3120000-0000-4000-8000-00000000000a' and kind = 'post'), 'approve'),
  'approved', 'the founder approves the post card');
select is((select status from public.content_items where id = pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')),
  'approved', 'the post is approved');
select is(pg_temp.slots(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')),
  'linkedin intent proposed, threads publish proposed, x publish waiting',
  'three slots: X and Threads from their accounts, LinkedIn copy and open; X already waits for its time');
select is((select publish_at from pg_temp.slot(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'x')),
  (select (snapshot->'proposed'->>'at')::timestamptz from public.approvals where user_id = 'e3120000-0000-4000-8000-00000000000a' and kind = 'post'),
  'X goes out at the time the post card showed');
select is(pg_temp.waiting_cards(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')), 'linkedin, threads',
  'a schedule card for Threads and LinkedIn, none for X');
select is((select a.status from public.approvals a where a.ref_kind = 'schedule_slot'
  and a.ref_id = (pg_temp.slot(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'x')).id), 'approved',
  'X''s approval is the post card''s, kept for the firing to check');

-- Approve both schedule cards.
select is(pg_temp.decide((select id from public.approvals where ref_kind = 'schedule_slot' and status = 'waiting'
  and ref_id = (pg_temp.slot(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'threads')).id), 'approve'), 'approved', 'Threads is approved');
select is(pg_temp.decide((select id from public.approvals where ref_kind = 'schedule_slot' and status = 'waiting'
  and ref_id = (pg_temp.slot(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'linkedin')).id), 'approve'), 'approved', 'LinkedIn is approved');
select is(pg_temp.slots(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')),
  'linkedin intent waiting, threads publish waiting, x publish waiting', 'every platform waits for its time');
select is(pg_temp.waiting_cards(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')), '', 'no card is left to decide');

-- 4. Out on every platform. X posts first (Zernio's webhook).
select is((public.publish_status((pg_temp.slot(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'x')).id,
  'published', 'ext-flow-x', 'https://x.com/founder/status/312')).status, 'published', 'X posts');
select ok((pg_temp.slot(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'threads')).status = 'waiting',
  'Threads still waits for its own time');

-- Decision F1 (Task 2, Session B: `309_post_published_first`): a post is published when its first platform posts.
-- Until 309 lands this is a TODO, so it reports without failing the suite.
select todo_start('needs 309: a post is published when its first platform posts (F1)');
select is((select status || ' ' || coalesce(external_url, '-') from public.content_items
  where id = pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')),
  'published https://x.com/founder/status/312', 'the post counts as posted once X is live, with X''s link');
select todo_end();

select is((public.publish_status((pg_temp.slot(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'threads')).id,
  'published', 'ext-flow-th', 'https://www.threads.net/@founder/post/312')).status, 'published', 'Threads posts after X');

-- LinkedIn is copy and open: at its time the founder gets the reminder (as the reminder cron sets it), posts it
-- themselves and says so.
update public.schedule_slots set status = 'reminded'
where id = (pg_temp.slot(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'linkedin')).id;
set local role authenticated;
select lives_ok(format($$ select public.schedule_mark_posted(%L) $$,
  (pg_temp.slot(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today'), 'linkedin')).id), 'the founder marks LinkedIn posted');
reset role;
select is(pg_temp.slots(pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')),
  'linkedin intent published, threads publish published, x publish published', 'all three platforms are published');
select is((select status from public.content_items where id = pg_temp.item('e3120000-0000-4000-8000-00000000000a', 'Today')),
  'published', 'the post is published');

-- 5. Founder B, no account at all: the same flow gives three copy-and-open slots and nothing errors.
select is(public.cmo_plan_week('e3120000-0000-4000-8000-00000000000b', 'e3121000-0000-4000-8000-00000000000b', jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'X', 'targets', jsonb_build_array('x', 'threads', 'linkedin'), 'slot', 0,
    'day', current_date, 'idea', 'Today', 'reason', 'r'))), 1, 'founder B''s week plan');
select pg_temp.draft('e3120000-0000-4000-8000-00000000000b', 'e3121000-0000-4000-8000-00000000000d',
  pg_temp.item('e3120000-0000-4000-8000-00000000000b', 'Today'), 'A post with nowhere connected to go.');
set local request.jwt.claims = '{"sub":"e3120000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is(pg_temp.decide((select id from public.approvals where user_id = 'e3120000-0000-4000-8000-00000000000b' and kind = 'post'), 'approve'),
  'approved', 'founder B approves the card');
select is(pg_temp.slots(pg_temp.item('e3120000-0000-4000-8000-00000000000b', 'Today')),
  'linkedin intent proposed, threads intent proposed, x intent waiting', 'three copy-and-open slots, X on the card''s time');

select * from finish();
rollback;
