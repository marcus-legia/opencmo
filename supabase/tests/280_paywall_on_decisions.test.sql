-- cmo-review-3 A3 (20270113050000): the paywall on decisions. A founder without a plan cannot approve or post a post,
-- through the app's RPC or any write of the rows, and is refused with P0402 (the plan sheet). Skipping stays free, as
-- do a script's (video) approval and a cron's write. A paid founder is unchanged. A slot cannot be approved either.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(11);

select ok(not has_function_privilege('authenticated', 'public.paywall_on_send()', 'execute'), 'the rule is internal');

insert into auth.users (id, email) values
  ('e2800000-0000-4000-8000-00000000000a', 'pay-a@test.local'),
  ('e2800000-0000-4000-8000-00000000000b', 'pay-b@test.local');
update public.profiles set plan = 'starter' where id = 'e2800000-0000-4000-8000-00000000000b';

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e2801000-0000-4000-8000-00000000000a', 'e2800000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
   'post_draft', 'Posts', '{}', 'writer', 'done');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2802000-0000-4000-8000-00000000000a', 'e2800000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Free', 'in_review',
   '{"text":"The free first draft."}'),
  ('e2802000-0000-4000-8000-00000000000b', 'e2800000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Skip', 'in_review',
   '{"text":"One to skip."}'),
  ('e2802000-0000-4000-8000-00000000000c', 'e2800000-0000-4000-8000-00000000000a', 'video', 'Video', current_date, 'Script', 'in_review',
   '{}'),
  ('e2802000-0000-4000-8000-00000000000d', 'e2800000-0000-4000-8000-00000000000b', 'post', 'X', current_date, 'Paid', 'in_review',
   '{"text":"A paid founder posts."}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2803000-0000-4000-8000-00000000000a', 'e2800000-0000-4000-8000-00000000000a', 'e2801000-0000-4000-8000-00000000000a', 'post',
   'content_item', 'e2802000-0000-4000-8000-00000000000a', 'waiting_founder');
insert into public.schedule_slots (id, user_id, deliverable_id, platform, mode, publish_at, window_ends_at) values
  ('e2804000-0000-4000-8000-00000000000a', 'e2800000-0000-4000-8000-00000000000a', 'e2803000-0000-4000-8000-00000000000a', 'x', 'intent',
   now() + interval '1 day', now() + interval '1 day 15 minutes');

-- The app's own path, as the unpaid founder.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2800000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.cmo_decide_post('e2802000-0000-4000-8000-00000000000a', 'approve') $$, 'P0402', null,
  'unpaid: approving a post asks for a plan');
select lives_ok($$ select public.cmo_decide_post('e2802000-0000-4000-8000-00000000000b', 'skip', null, 'Too salesy') $$,
  'unpaid: skipping stays free');
reset role;
select is((select status from public.content_items where id = 'e2802000-0000-4000-8000-00000000000a'), 'in_review', 'the draft still waits');

-- Any other write of the rows, still as that founder (the RPCs run as definer; the rule reads who asks).
set local request.jwt.claims = '{"sub":"e2800000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ update public.content_items set status = 'published' where id = 'e2802000-0000-4000-8000-00000000000a' $$, 'P0402', null,
  'unpaid: marking a post posted asks for a plan');
select throws_ok($$ update public.schedule_slots set status = 'waiting' where id = 'e2804000-0000-4000-8000-00000000000a' $$, 'P0402', null,
  'unpaid: approving a slot asks for a plan');
select lives_ok($$ update public.content_items set status = 'approved' where id = 'e2802000-0000-4000-8000-00000000000c' $$,
  'unpaid: approving a script to film stays free');
select lives_ok($$ update public.content_items set body = '{"text":"Edited words."}' where id = 'e2802000-0000-4000-8000-00000000000a' $$,
  'unpaid: editing words stays free');

-- A paid founder approves as before.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2800000-0000-4000-8000-00000000000b","role":"authenticated"}';
select lives_ok($$ select public.cmo_decide_post('e2802000-0000-4000-8000-00000000000d', 'approve') $$, 'paid: approving works');
reset role;
select is((select status from public.content_items where id = 'e2802000-0000-4000-8000-00000000000d'), 'approved', 'and the post is approved');

-- A cron or the worker (no user) is never stopped here.
set local request.jwt.claims = '';
select lives_ok($$ update public.schedule_slots set status = 'waiting' where id = 'e2804000-0000-4000-8000-00000000000a' $$,
  'no user (cron, worker): not checked');

select * from finish();
rollback;
