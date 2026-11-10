-- cmo-review-3 2.2 (20270113030000): "Rate your first drafts". A round is one to five versions of the founder's own
-- waiting posts, once a day; rating is not deciding; it queues `distill_ratings`, free. The job's rules raise no
-- card; the founder accepts a subset in one step and the rest are set aside.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(23);

select has_table('public', 'cmo_draft_ratings', 'the ratings table exists');
select ok(has_table_privilege('authenticated', 'public.cmo_draft_ratings', 'select'), 'founders read their ratings');
select ok(not has_table_privilege('authenticated', 'public.cmo_draft_ratings', 'insert'), 'and write them only through the RPC');
select ok(not has_function_privilege('authenticated', 'public.cmo_propose_rating_rules(uuid,uuid,text[])', 'execute'), 'only the job writes rules');

insert into auth.users (id, email) values
  ('e2780000-0000-4000-8000-00000000000a', 'rate-a@test.local'),
  ('e2780000-0000-4000-8000-00000000000b', 'rate-b@test.local');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2781000-0000-4000-8000-00000000000a', 'e2780000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'First', 'in_review',
   '{"text":"Our revolutionary app changes invoicing forever.","alternates":["Late invoices are a process problem.","Send reminders on day 3."]}'),
  ('e2781000-0000-4000-8000-00000000000b', 'e2780000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Second', 'in_review',
   '{"text":"Buy now: the best invoicing tool ever made."}'),
  ('e2781000-0000-4000-8000-00000000000c', 'e2780000-0000-4000-8000-00000000000b', 'post', 'X', current_date, 'Theirs', 'in_review',
   '{"text":"Someone else''s draft."}');

create temp table t_round (r jsonb) on commit drop;
grant select, insert on t_round to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2780000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.enqueue_cmo_run('distill_ratings', '{}') $$, '22023', 'Unknown task.', 'the free job is queued by a round only');
select throws_ok($$ select public.cmo_rate_drafts('[]') $$, '22023', 'Rate one to five drafts.', 'an empty round is refused');
select throws_ok($$ select public.cmo_rate_drafts((select jsonb_agg(jsonb_build_object('item_id', 'e2781000-0000-4000-8000-00000000000a', 'version', 0, 'verdict', 'up')) from generate_series(1, 6))) $$,
  '22023', 'Rate one to five drafts.', 'six ratings are refused');
select throws_ok($$ select public.cmo_rate_drafts('[{"item_id":"e2781000-0000-4000-8000-00000000000c","version":0,"verdict":"down"}]') $$,
  'P0002', 'Only drafts that wait for you can be rated.', 'another founder''s draft is not found');
select throws_ok($$ select public.cmo_rate_drafts('[{"item_id":"e2781000-0000-4000-8000-00000000000b","version":2,"verdict":"down"}]') $$,
  '22023', 'That version is not on the draft.', 'a version the draft does not have is refused');
select throws_ok($$ select public.cmo_rate_drafts('[{"item_id":"e2781000-0000-4000-8000-00000000000b","version":0,"verdict":"up","reason_code":"TOO_SALESY"}]') $$,
  '22023', 'Pick a reason from the list, on a draft you rated down.', 'a reason goes with a thumbs down');

insert into t_round
select public.cmo_rate_drafts('[
  {"item_id":"e2781000-0000-4000-8000-00000000000a","version":0,"verdict":"down","reason_code":"TOO_SALESY"},
  {"item_id":"e2781000-0000-4000-8000-00000000000a","version":1,"verdict":"up"},
  {"item_id":"e2781000-0000-4000-8000-00000000000a","version":2,"verdict":"up","note":"Specific, I like it."},
  {"item_id":"e2781000-0000-4000-8000-00000000000b","version":0,"verdict":"down","reason_code":"TOO_SALESY"}
]'::jsonb);
select is((select count(*)::int from public.cmo_draft_ratings), 4, 'the round is stored');
select throws_ok($$ select public.cmo_rate_drafts('[{"item_id":"e2781000-0000-4000-8000-00000000000b","version":0,"verdict":"up"}]') $$,
  'P0001', 'You rated drafts today. Rate again tomorrow.', 'one round a day');
reset role;

select is((select kind || ':' || status || ':' || credits from public.cmo_runs where id = (select (r->>'run_id')::uuid from t_round)),
  'distill_ratings:queued:0', 'the round queues its free job');
select is((select count(*)::int from public.approvals where ref_id in ('e2781000-0000-4000-8000-00000000000a', 'e2781000-0000-4000-8000-00000000000b') and status = 'waiting'),
  2, 'rating is not deciding: the cards still wait');
select is((select words from public.cmo_draft_ratings where item_id = 'e2781000-0000-4000-8000-00000000000a' and version = 1),
  'Late invoices are a process problem.', 'the words rated are kept');

-- The job's rules raise no card.
set local role service_role;
select is(public.cmo_propose_rating_rules('e2780000-0000-4000-8000-00000000000a', (select (r->>'round')::uuid from t_round),
  array['Help first: drop the pitch and the hype.', 'Name one specific step, like a day to send the reminder.', 'x']), 2, 'two rules kept, a too short one dropped');
reset role;
select is((select count(*)::int from public.approvals where ref_kind = 'correction' and user_id = 'e2780000-0000-4000-8000-00000000000a'), 0, 'no card per rule');

-- Accept one, edited; the other is set aside.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2780000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_accept_corrections(%L, '{}', '{}') $$, (select (r->>'round')::uuid from t_round)),
  'P0002', 'These rules were not found.', 'another founder cannot accept them');
set local request.jwt.claims = '{"sub":"e2780000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is(public.cmo_accept_corrections((select (r->>'round')::uuid from t_round),
  array[(select id from public.cmo_corrections where rule like 'Help first%')], array['Help first: no pitch, no hype.']), 1, 'one rule accepted');
reset role;
select is((select string_agg(status || ':' || rule, ' | ' order by status) from public.cmo_corrections where user_id = 'e2780000-0000-4000-8000-00000000000a'),
  'active:Help first: no pitch, no hype. | rejected:Name one specific step, like a day to send the reminder.', 'the ticked one is active with its words, the other set aside');
select is((select count(*)::int from public.approvals where ref_kind = 'correction' and user_id = 'e2780000-0000-4000-8000-00000000000a'), 0, 'still no card');

-- A later round: the earlier round's rules still waiting are set aside, and the same words can be proposed again.
reset role;
insert into public.cmo_corrections (user_id, rule, source, status, round_id)
values ('e2780000-0000-4000-8000-00000000000a', 'Keep it short.', 'ratings', 'proposed', (select (r->>'round')::uuid from t_round));
insert into public.cmo_draft_ratings (user_id, item_id, version, verdict, words, round)
values ('e2780000-0000-4000-8000-00000000000a', 'e2781000-0000-4000-8000-00000000000b', 0, 'down', 'Buy now.', 'e2782000-0000-4000-8000-00000000000b');
set local role service_role;
select is(public.cmo_propose_rating_rules('e2780000-0000-4000-8000-00000000000a', 'e2782000-0000-4000-8000-00000000000b', array['Keep it short.']), 1,
  'a rule left waiting in an earlier round can be proposed again');
reset role;
select is((select string_agg(status, ',' order by round_id = 'e2782000-0000-4000-8000-00000000000b') from public.cmo_corrections where rule = 'Keep it short.'),
  'rejected,proposed', 'and the earlier one is set aside');

select * from finish();
rollback;
