-- P2 A1 (20261228100000): a priced Studio step raises its card; `approval_decide` decides script, price and finished
-- video cards (approve, edit a beat, redo a keyframe, cancel, send back), refuses a stale hash, and the step reports
-- back through `studio_step_finish`. `mark_finished` marks only the document the founder saw.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(50);

select ok(has_function_privilege('authenticated', 'public.studio_step_raise(uuid,text,text,jsonb,jsonb,integer,uuid,uuid)', 'execute'),
  'the adapter raises steps under the founder''s session');
select ok(not has_function_privilege('anon', 'public.studio_step_raise(uuid,text,text,jsonb,jsonb,integer,uuid,uuid)', 'execute'), 'anon cannot');
select ok(has_function_privilege('authenticated', 'public.mark_finished(uuid,text)', 'execute'), 'founders mark edits finished');
select ok(not has_function_privilege('authenticated', 'public.studio_steps_sync()', 'execute'), 'only the trigger syncs cards');

insert into auth.users (id, email) values
  ('e2060000-0000-4000-8000-00000000000a', 'a1@test.local'),
  ('e2060000-0000-4000-8000-00000000000b', 'a1-other@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2061000-0000-4000-8000-00000000000a', 'e2060000-0000-4000-8000-00000000000a', 'https://a', 60, 'done'),
  ('e2061000-0000-4000-8000-00000000000b', 'e2060000-0000-4000-8000-00000000000b', 'https://b', 60, 'done');
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, kind) values
  ('e2062000-0000-4000-8000-00000000000a', 'e2061000-0000-4000-8000-00000000000a', -1, 'Editor launch', 0, 0, 'blank'),
  ('e2062000-0000-4000-8000-00000000000b', 'e2061000-0000-4000-8000-00000000000b', -1, 'Other', 0, 0, 'blank');
insert into public.editor_projects (clip_id, document) values
  ('e2062000-0000-4000-8000-00000000000a', '{"version":1,"stage":{"name":"launch"}}'),
  ('e2062000-0000-4000-8000-00000000000b', '{"version":1,"stage":{"name":"other"}}');
-- A video order waiting on the founder, under the week's root.
select public.work_order_create('e2060000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date, null,
  'plan_week', 'Week', '{}', 100);
select public.work_order_create('e2060000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from public.work_orders where user_id = 'e2060000-0000-4000-8000-00000000000a' and parent_id is null),
  'build_video', 'How the CMO plans a week', '{}', 50, null, '{}', 'loop', null, 'studio');
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;
insert into t select 'order', id from public.work_orders where kind = 'build_video' and user_id = 'e2060000-0000-4000-8000-00000000000a';
select public.work_order_move((select id from t where name = 'order'), 'running');
select public.work_order_move((select id from t where name = 'order'), 'waiting_founder');

create function pg_temp.card(p_step uuid) returns public.approvals language sql as $$
  select * from public.approvals where ref_kind = 'studio_step' and ref_id = p_step order by (status = 'waiting') desc, created_at desc limit 1
$$;
create function pg_temp.decide(p_step uuid, p_action text, p_extra jsonb default '{}') returns public.approvals language sql as $$
  select public.approval_decide((pg_temp.card(p_step)).id, p_action,
    p_extra || jsonb_build_object('content_hash', (pg_temp.card(p_step)).content_hash))
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2060000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';

-- Only the brain's runner stores steps: a founder calling the RPC directly is refused.
set local request.jwt.claims = '{"sub":"e2060000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.studio_step_raise('e2062000-0000-4000-8000-00000000000a', 'create_video', 'script', '{}',
  '{"beats":[]}', 0) $$, '42501', null, 'a founder cannot store a Studio step');
set local request.jwt.claims = '{"sub":"e2060000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';

-- Raise: card 1 (script) for the order.
insert into t select 's1', id from public.studio_step_raise('e2062000-0000-4000-8000-00000000000a', 'create_video', 'script',
  '{"plan":"prepared"}',
  '{"title":"How the CMO plans a week","seconds":60,"aspect":"9:16","beats":[{"words":"You recorded the demo.","picture":"Desk.","motion":"Push in."},{"words":"Now cut it by words.","picture":"Lines.","motion":null}]}',
  6, (select id from t where name = 'order'));
select is((pg_temp.card((select id from t where name = 's1'))).status, 'waiting', 'a raised step waits on its card');
select is((pg_temp.card((select id from t where name = 's1'))).kind || ' ' || (pg_temp.card((select id from t where name = 's1'))).department
  || ' ' || (pg_temp.card((select id from t where name = 's1'))).price_credits, 'script studio 6', 'card 1: a Studio script with the keyframe price');
select is((select status from public.studio_steps where id = (select id from t where name = 's1')), 'waiting', 'nothing runs before the card');

select throws_ok($$ select public.studio_step_raise('e2062000-0000-4000-8000-00000000000b', 'create_video', 'script', '{}', '{"beats":[]}', 1) $$,
  'P0002', null, 'a step only on the founder''s own edit');
select throws_ok($$ select public.studio_step_raise('e2062000-0000-4000-8000-00000000000a', 'delete_everything', 'price', '{}', '{}', 1) $$,
  '22023', null, 'only priced Studio tools');
select throws_ok($$ select public.studio_step_raise('e2062000-0000-4000-8000-00000000000a', 'animate_video', 'script', '{}', '{"beats":[]}', 1) $$,
  '22023', null, 'only a storyboard is a script card');
select throws_ok($$ select public.studio_step_raise('e2062000-0000-4000-8000-00000000000a', 'animate_video', 'price', '{}', '{"seconds":60}', -1) $$,
  '22023', null, 'a step needs its price');
select throws_ok($$ select public.studio_step_raise('e2062000-0000-4000-8000-00000000000a', 'animate_video', 'price', '{}', '{"shots":3}', 9) $$,
  '22023', null, 'a price card says how long the video is');

-- Stale and wrong decisions are refused.
select throws_ok($$ select public.approval_decide((pg_temp.card((select id from t where name = 's1'))).id, 'approve',
  jsonb_build_object('content_hash', repeat('0', 64))) $$, 'P0001', 'This card changed. Look at it again before deciding.', 'a stale hash is refused');
select throws_ok($$ select pg_temp.decide((select id from t where name = 's1'), 'redo', '{"index":0}') $$,
  '22023', 'Choose approve, edit a beat or cancel.', 'a script has no redo');
select throws_ok($$ select pg_temp.decide((select id from t where name = 's1'), 'edit', '{"beat":5,"text":"x"}') $$,
  '22023', 'That beat is not in the script.', 'only a beat of the script');
select throws_ok($$ select pg_temp.decide((select id from t where name = 's1'), 'edit', '{"beat":0,"text":"  "}') $$,
  '22023', null, 'a beat is never empty');
select throws_ok($$ select pg_temp.decide((select id from t where name = 's1'), 'edit', '{"beat":0.6,"text":"x"}') $$,
  '22023', 'Say which beat to change.', 'a fractional beat is refused, not rounded');

-- Edit a beat: the card closes as edited, the step stops, the order keeps waiting.
select is((pg_temp.decide((select id from t where name = 's1'), 'edit', '{"beat":1,"text":"Cut it by deleting words.","reason":"Shorter line"}')).status,
  'edited', 'editing a beat closes the card as edited');
select is((select status || ' ' || decision || ' ' || (decision_payload->>'beat') from public.studio_steps where id = (select id from t where name = 's1')),
  'cancelled edit 1', 'the step records the beat; the adapter re-plans');
select is((pg_temp.card((select id from t where name = 's1'))).reason, 'Shorter line', 'with the founder''s reason');
reset role;
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'waiting_founder', 'the order keeps waiting');
select is((select count(*)::int from public.studio_steps_ready(10) where id = (select id from t where name = 's1') and next->>'tool' = 'replan'), 1,
  'the order runner picks up the re-plan');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2060000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';

-- The re-planned card 1, approved.
insert into t select 's2', id from public.studio_step_raise('e2062000-0000-4000-8000-00000000000a', 'create_video', 'script',
  '{"plan":"prepared v2"}', '{"title":"How the CMO plans a week","beats":[{"words":"Cut it by deleting words.","picture":"Lines.","motion":null}]}',
  6, (select id from t where name = 'order'));
select is((pg_temp.decide((select id from t where name = 's2'), 'approve')).status, 'approved', 'approving card 1 closes it');
select is((select status || ' ' || decision from public.studio_steps where id = (select id from t where name = 's2')), 'approved approve',
  'the step is approved for the adapter to run');
select throws_ok($$ select pg_temp.decide((select id from t where name = 's2'), 'approve') $$, 'P0001', 'This card was already decided.',
  'a card is decided once');

-- The adapter reports back.
select is((public.studio_step_finish((select id from t where name = 's2'), 'running', null, 'e2069000-0000-4000-8000-000000000001')).generation_id::text,
  'e2069000-0000-4000-8000-000000000001', 'a running step names the generation it waits on');
select throws_ok($$ select public.studio_step_finish((select id from t where name = 's2'), 'failed') $$, '22023', null, 'a failed step says why');
select is((public.studio_step_finish((select id from t where name = 's2'), 'done')).status, 'done', 'and is done');
select throws_ok($$ select public.studio_step_finish((select id from t where name = 's2'), 'running') $$, 'P0001', null, 'done is final');
select throws_ok($$ select public.studio_step_finish((select id from t where name = 's1'), 'done') $$, 'P0001', null,
  'a step never runs without an approval');

-- Card 2: the contact sheet. Redo one keyframe, then a new card from the redone sheet.
insert into t select 'p1', id from public.studio_step_raise('e2062000-0000-4000-8000-00000000000a', 'animate_video', 'price',
  '{"shots":"prepared"}',
  '{"title":"How the CMO plans a week","what":"2 shots, voice-over","seconds":60,"wait_minutes":25,"keyframes":[{"index":0,"words":"a","path":"u/0.png","garbled":false,"credits":1},{"index":1,"words":"b","path":"u/1.png","garbled":true,"credits":1}],"shots":2}',
  24, (select id from t where name = 'order'));
select is((pg_temp.card((select id from t where name = 'p1'))).price_credits, 24, 'card 2 carries the video price');
select throws_ok($$ select pg_temp.decide((select id from t where name = 'p1'), 'redo', '{"index":0.5}') $$,
  '22023', 'Say which keyframe to make again.', 'a fractional keyframe is refused, not rounded');
select throws_ok($$ select pg_temp.decide((select id from t where name = 'p1'), 'redo', '{"index":7}') $$,
  '22023', 'That keyframe is not on the sheet.', 'only a keyframe on the sheet');
select is((pg_temp.decide((select id from t where name = 'p1'), 'redo', '{"index":1}')).status, 'edited', 'redo closes card 2 as edited');
select is((select status || ' ' || (decision_payload->>'index') from public.studio_steps where id = (select id from t where name = 'p1')),
  'approved 1', 'the step is approved for one keyframe again');
insert into t select 'p2', id from public.studio_step_raise('e2062000-0000-4000-8000-00000000000a', 'animate_video', 'price',
  '{"shots":"prepared v2"}', '{"title":"How the CMO plans a week","seconds":60,"keyframes":[{"index":0,"words":"a","path":"u/0.png","garbled":false,"credits":1},{"index":1,"words":"b","path":"u/1b.png","garbled":false,"credits":1}],"shots":2}',
  24, (select id from t where name = 'order'), (select id from t where name = 'p1'));
select is((select redo_of from public.studio_steps where id = (select id from t where name = 'p2')), (select id from t where name = 'p1'),
  'the new sheet points at the one it replaces');
reset role;
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'waiting_founder',
  'redoing a keyframe keeps the order waiting');
-- A changed price supersedes the waiting card: the founder never approves a price they did not see.
update public.studio_steps set price_credits = 26 where id = (select id from t where name = 'p2');
select is((select count(*)::int from public.approvals where ref_id = (select id from t where name = 'p2')), 2, 'a new price raises a new card');
select is((select status from public.approvals where ref_id = (select id from t where name = 'p2') and price_credits = 24), 'cancelled',
  'and supersedes the old one');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2060000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';

-- Cancel: the step stops, the video's order is cancelled, nothing was held.
select is((pg_temp.decide((select id from t where name = 'p2'), 'cancel', '{"reason":"Not this week"}')).status, 'skipped', 'cancel closes the card');
select is((select status from public.studio_steps where id = (select id from t where name = 'p2')), 'cancelled', 'the step stops');
reset role;
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'cancelled', 'and so does the video''s order');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2060000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';

-- Card 3 and Mark finished.
reset role;
select public.approval_raise('e2060000-0000-4000-8000-00000000000a', 'editor_project', 'e2062000-0000-4000-8000-00000000000a');
insert into t select 'f1', id from public.approvals where ref_kind = 'editor_project' and status = 'waiting';
update public.editor_projects set document = '{"version":1,"stage":{"name":"launch v2"}}' where clip_id = 'e2062000-0000-4000-8000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2060000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';
select throws_ok($$ select public.approval_decide((select id from t where name = 'f1'), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = (select id from t where name = 'f1')))) $$,
  'P0001', null, 'card 3 of an older document is refused (A3 also closes it when the document changes)');
reset role;
select public.approval_raise('e2060000-0000-4000-8000-00000000000a', 'editor_project', 'e2062000-0000-4000-8000-00000000000a');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2060000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';
select is((select public.approval_decide(id, 'send_back', jsonb_build_object('content_hash', content_hash, 'reason', 'Music too loud'))
  from public.approvals where ref_kind = 'editor_project' and status = 'waiting').status, 'skipped', 'send back closes card 3');
select is((select finished_at from public.editor_projects where clip_id = 'e2062000-0000-4000-8000-00000000000a'), null, 'and keeps the edit open');
reset role;
select public.approval_raise('e2060000-0000-4000-8000-00000000000a', 'editor_project', 'e2062000-0000-4000-8000-00000000000a');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2060000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';
select is((select public.approval_decide(id, 'approve', jsonb_build_object('content_hash', content_hash))
  from public.approvals where ref_kind = 'editor_project' and status = 'waiting').status, 'approved', 'approving card 3');
select is((select finished_hash from public.editor_projects where clip_id = 'e2062000-0000-4000-8000-00000000000a'),
  public.editor_document_hash('{"version":1,"stage":{"name":"launch v2"}}'::jsonb), 'marks the edit finished at the document on the card');
select throws_ok($$ select public.mark_finished('e2062000-0000-4000-8000-00000000000a', repeat('a', 64)) $$,
  'P0001', 'This edit changed. Look at it again before marking it finished.', 'Mark finished refuses a document the founder did not see');
select throws_ok($$ select public.mark_finished('e2062000-0000-4000-8000-00000000000b',
  public.editor_document_hash('{"version":1,"stage":{"name":"other"}}'::jsonb)) $$, 'P0002', null, 'and another founder''s edit');

select * from finish();
rollback;
