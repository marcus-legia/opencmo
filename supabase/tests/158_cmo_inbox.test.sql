-- 20261128090000: the CMO inbox — a run that thinks with the founder's Claude stops at its model
-- call, the founder's Claude answers over MCP, and the answer replays the job at 0 credits.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(33);

insert into auth.users (id, email) values
  ('e1580000-0000-4000-8000-00000000000a', 'inbox-a@test.local'),
  ('e1580000-0000-4000-8000-00000000000b', 'inbox-b@test.local');
-- API keys and the free `brain = 'claude'` are paid-plan features (20261210101000).
update public.profiles set plan = 'starter' where id in ('e1580000-0000-4000-8000-00000000000a', 'e1580000-0000-4000-8000-00000000000b');

-- An inbox run holds no credits, even for a founder with none.
select is(
  (select credits from public.enqueue_cmo_run_for('e1580000-0000-4000-8000-00000000000a', 'post_draft', '{"brain":"claude","loop":"daily-x-draft"}')),
  0, 'an inbox run holds 0 credits');
select throws_ok(
  $$ select public.enqueue_cmo_run_for('e1580000-0000-4000-8000-00000000000a', 'plan_week', '{"inbox":"e1580000-0000-4000-8000-0000000000ff"}') $$,
  '22023', 'This request is not valid.', 'only inbox_submit starts a replay');
select throws_ok(
  $$ select public.enqueue_cmo_run_for('e1580000-0000-4000-8000-00000000000a', 'sales_scan', '{}') $$,
  'P0001', null, 'a normal run still needs credits');

-- The runner claims it and reaches the model call.
create temp table r as select * from public.claim_cmo_run(null, 300);
grant select on r to authenticated;
select is((select status from r), 'running', 'the runner claims the inbox run');

select is(
  (select step from public.cmo_inbox_open((select id from r), (select attempt from r), 'draft_post',
    '{"title":"Write today''s X post","system":"s","prompt":"p","schema":{}}', '{}')),
  'draft_post', 'the request lands in the inbox');
select is((select status from public.cmo_runs where id = (select id from r)), 'done', 'the run ends in the same call');
select is((select output->>'waiting_for' from public.cmo_runs where id = (select id from r)), 'draft_post', 'Activity can say what it waits for');
select is((select input ? 'brain' from public.cmo_inbox), false, 'the item keeps the input without the brain flag');
select is(
  (select public.cmo_inbox_open((select id from r), (select attempt from r), 'draft_post', '{}', '{}')),
  null, 'a stale attempt opens nothing');

create temp table i as select id from public.cmo_inbox;
grant select on i to authenticated;

-- The founder's Claude, under the founder's session.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1580000-0000-4000-8000-00000000000a"}';

select is((select count(*)::int from public.inbox_list()), 1, 'the founder sees the item');
select is((select status from public.inbox_list()), 'open', 'open until claimed');
select is((select title from public.inbox_list()), 'Write today''s X post', 'with the task in one line');
select throws_ok($$ insert into public.cmo_inbox (user_id, kind, step, request) values ('e1580000-0000-4000-8000-00000000000a', 'plan_week', 'x', '{}') $$,
  '42501', null, 'no direct writes');
select is((select status from public.inbox_claim((select id from i))), 'claimed', 'Claude claims it');
select is((select request->>'title' from public.inbox_claim((select id from i))), 'Write today''s X post', 'claiming again returns the request');
select throws_ok(
  $$ select public.inbox_submit((select id from i), 'e1580000-0000-4000-8000-000000000001', 'plan_items', '{"items":[]}') $$,
  'P0001', null, 'an answer for another step is refused');
select throws_ok(
  $$ select public.inbox_submit((select id from i), 'e1580000-0000-4000-8000-000000000001', 'draft_post', '[1]') $$,
  '22023', 'This answer is not valid.', 'the answer must be an object');
select is(
  (select status from public.inbox_submit((select id from i), 'e1580000-0000-4000-8000-000000000001', 'draft_post', '{"versions":[],"rationale":"r"}')),
  'submitted', 'the answer is accepted');
select is(
  (select run_id from public.inbox_submit((select id from i), 'e1580000-0000-4000-8000-000000000001', 'draft_post', '{"versions":[],"rationale":"r"}')),
  (select run_id from public.cmo_inbox where id = (select id from i)), 'the same submission twice is one replay');
select is((select count(*)::int from public.cmo_runs where input->>'inbox' = (select id from i)::text), 1, 'exactly one replay run');
select is((select credits from public.cmo_runs where input->>'inbox' = (select id from i)::text), 0, 'the replay holds 0 credits');

set local request.jwt.claims = '{"sub":"e1580000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.inbox_list()), 0, 'another founder sees nothing');
select throws_ok($$ select public.inbox_claim((select id from i)) $$, 'P0002', 'Inbox item not found.', 'and cannot claim it');
select throws_ok(
  $$ select public.inbox_submit((select id from i), 'e1580000-0000-4000-8000-000000000002', 'draft_post', '{}') $$,
  'P0002', 'Inbox item not found.', 'or answer it');
select throws_ok($$ select public.cmo_inbox_finish((select id from r), true) $$, '42501', null, 'the finish RPC is service-only');

reset role;

-- The replay fails a check: the item reopens on the same step, without that answer.
create temp table r2 as select * from public.claim_cmo_run(null, 300);
select is((select input->>'inbox' from r2), (select id from i)::text, 'the runner claims the replay');
select is((select status from public.cmo_inbox_finish((select id from r2), false, 'The drafts did not pass our checks.')), 'open', 'a failed check reopens the item');
select is((select answers ? 'draft_post' from public.cmo_inbox where id = (select id from i)), false, 'without the failed answer');
select is((select feedback from public.cmo_inbox where id = (select id from i)), 'The drafts did not pass our checks.', 'with the reason');

select public.complete_cmo_run((select id from r2), (select attempt from r2), false, null, 'The drafts did not pass our checks.');

-- A replay that died without reporting back does not leave the item waiting forever.
update public.cmo_inbox set status = 'submitted', answers = answers || '{"draft_post":{}}' where id = (select id from i);
update public.cmo_runs set status = 'failed', error = 'This task stopped too many times.' where id = (select id from r2);
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1580000-0000-4000-8000-00000000000a"}';
select is((select status from public.inbox_claim((select id from i))), 'claimed', 'a dead replay reopens the item on the next read');
select is((select feedback from public.cmo_inbox where id = (select id from i)), 'This task stopped too many times. Answer again.', 'with the reason');
reset role;

-- A fresh scheduled item replaces an unanswered one of the same kind.
select public.enqueue_cmo_run_for('e1580000-0000-4000-8000-00000000000a', 'post_draft', '{"brain":"claude"}');
create temp table r3 as select * from public.claim_cmo_run(null, 300);
select public.cmo_inbox_open((select id from r3), (select attempt from r3), 'draft_post', '{"title":"t"}', '{}');
select is((select status from public.cmo_inbox where id = (select id from i)), 'expired', 'the older unanswered item expires');
select is((select count(*)::int from public.cmo_inbox where status = 'open'), 1, 'one open item per kind');

select * from finish();
rollback;
