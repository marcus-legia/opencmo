-- P2 A0 (20261228090000): Studio's tables (studio_steps, short_batches, shorts), a short as its own edit, the
-- finished columns, and what each new approval card shows. Raising and deciding these cards is A1 and A3.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(37);

-- Grants, RLS, Realtime.
select ok(has_table_privilege('authenticated', 'public.studio_steps', 'select'), 'founders read their steps');
select ok(not has_table_privilege('authenticated', 'public.studio_steps', 'insert'), 'founders cannot insert steps');
select ok(not has_table_privilege('authenticated', 'public.studio_steps', 'update'), 'founders cannot update steps');
select ok(has_table_privilege('authenticated', 'public.short_batches', 'select'), 'founders read their batches');
select ok(not has_table_privilege('authenticated', 'public.short_batches', 'update'), 'founders cannot update batches');
select ok(has_table_privilege('authenticated', 'public.shorts', 'select'), 'founders read their shorts');
select ok(not has_table_privilege('authenticated', 'public.shorts', 'delete'), 'founders cannot delete shorts');
select ok(not has_table_privilege('anon', 'public.studio_steps', 'select')
  and not has_table_privilege('anon', 'public.shorts', 'select'), 'anon reads nothing');
select ok(has_table_privilege('service_role', 'public.studio_steps', 'insert')
  and has_table_privilege('service_role', 'public.shorts', 'update')
  and has_table_privilege('service_role', 'public.short_batches', 'update'), 'the runner writes them');
select ok((select bool_and(relrowsecurity) from pg_class
  where oid in ('public.studio_steps'::regclass, 'public.short_batches'::regclass, 'public.shorts'::regclass)), 'RLS is on');
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime'
  and tablename in ('studio_steps', 'short_batches', 'shorts')), 3, 'they stream over Realtime');

insert into auth.users (id, email) values
  ('e2050000-0000-4000-8000-00000000000a', 'p2-a@test.local'),
  ('e2050000-0000-4000-8000-00000000000b', 'p2-b@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2051000-0000-4000-8000-00000000000a', 'e2050000-0000-4000-8000-00000000000a', 'https://a', 60, 'done'),
  ('e2051000-0000-4000-8000-00000000000b', 'e2050000-0000-4000-8000-00000000000b', 'https://b', 60, 'done');
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, source_start, source_end, kind) values
  ('e2052000-0000-4000-8000-00000000000a', 'e2051000-0000-4000-8000-00000000000a', -1, 'Editor launch', 0, 0, null, null, 'blank'),
  ('e2052000-0000-4000-8000-00000000000b', 'e2051000-0000-4000-8000-00000000000b', -1, 'Other', 0, 0, null, null, 'blank');
insert into public.editor_projects (clip_id, document) values
  ('e2052000-0000-4000-8000-00000000000a', '{"version":1,"stage":{"name":"launch"}}'),
  ('e2052000-0000-4000-8000-00000000000b', '{"version":1,"stage":{"name":"other"}}');

-- A short is its own edit, pointing at its parent; nothing else may point at a parent.
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, source_start, source_end, kind, parent_clip_id)
values ('e2052000-0000-4000-8000-0000000000a1', 'e2051000-0000-4000-8000-00000000000a', -2, 'Cut by words', 0, 0, null, null,
  'short', 'e2052000-0000-4000-8000-00000000000a');
select is((select kind from public.clips where id = 'e2052000-0000-4000-8000-0000000000a1'), 'short', 'a short is a clips row');
select throws_ok($$ insert into public.clips (job_id, idx, start_seconds, end_seconds, kind, parent_clip_id)
  values ('e2051000-0000-4000-8000-00000000000a', -3, 0, 0, 'blank', 'e2052000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'only a short has a parent');
select throws_ok($$ insert into public.clips (job_id, idx, start_seconds, end_seconds, kind)
  values ('e2051000-0000-4000-8000-00000000000a', -3, 0, 0, 'moment') $$, '23514', null, 'clip kinds stay closed');

-- Finished: both columns or neither.
select throws_ok($$ update public.editor_projects set finished_at = now() where clip_id = 'e2052000-0000-4000-8000-00000000000a' $$,
  '23514', null, 'a finished mark needs its hash');
select throws_ok($$ update public.editor_projects set finished_at = now(), finished_hash = 'abc'
  where clip_id = 'e2052000-0000-4000-8000-00000000000a' $$, '23514', null, 'the hash is a sha256');
update public.editor_projects set finished_at = now(), finished_hash = public.editor_document_hash(document)
where clip_id = 'e2052000-0000-4000-8000-00000000000a';
select isnt((select finished_at from public.editor_projects where clip_id = 'e2052000-0000-4000-8000-00000000000a'), null,
  'an edit can be marked finished');

-- Steps: only the two card kinds, a closed status set, a price.
insert into public.studio_steps (id, user_id, clip_id, tool, kind, input, card, price_credits) values
  ('e2053000-0000-4000-8000-00000000000a', 'e2050000-0000-4000-8000-00000000000a', 'e2052000-0000-4000-8000-00000000000a',
   'create_video', 'script', '{"prepared":true}',
   '{"title":"How the CMO plans a week","seconds":60,"aspect":"9:16","beats":[{"words":"You recorded the demo.","picture":"Desk, laptop.","motion":"Slow push in."}],"internal":"not shown"}',
   6),
  ('e2053000-0000-4000-8000-00000000000b', 'e2050000-0000-4000-8000-00000000000a', 'e2052000-0000-4000-8000-00000000000a',
   'animate_video', 'price', '{"prepared":true}',
   '{"title":"How the CMO plans a week","what":"12 shots, voice-over, music","seconds":60,"wait_minutes":25,"keyframes":[{"index":0,"words":"You recorded the demo.","path":"u/k0.png","garbled":false,"credits":1}],"shots":12}',
   24),
  ('e2053000-0000-4000-8000-00000000000c', 'e2050000-0000-4000-8000-00000000000b', 'e2052000-0000-4000-8000-00000000000b',
   'create_video', 'script', '{}', '{"title":"Other"}', 3);
select throws_ok($$ insert into public.studio_steps (user_id, clip_id, tool, kind, input, card, price_credits)
  values ('e2050000-0000-4000-8000-00000000000a', 'e2052000-0000-4000-8000-00000000000a', 'create_video', 'shorts_batch', '{}', '{}', 0) $$,
  '23514', null, 'a step raises a script or a price card');
select throws_ok($$ update public.studio_steps set status = 'decided' where id = 'e2053000-0000-4000-8000-00000000000a' $$,
  '23514', null, 'step statuses are closed');
select throws_ok($$ update public.studio_steps set price_credits = -1 where id = 'e2053000-0000-4000-8000-00000000000a' $$,
  '23514', null, 'a price is never negative');

-- A batch of shorts cut from the finished edit.
insert into public.short_batches (id, user_id, parent_clip_id, parent_hash) values
  ('e2054000-0000-4000-8000-00000000000a', 'e2050000-0000-4000-8000-00000000000a', 'e2052000-0000-4000-8000-00000000000a',
   (select finished_hash from public.editor_projects where clip_id = 'e2052000-0000-4000-8000-00000000000a'));
insert into public.shorts (user_id, batch_id, parent_clip_id, short_clip_id, source_start, source_end, hook, reason) values
  ('e2050000-0000-4000-8000-00000000000a', 'e2054000-0000-4000-8000-00000000000a', 'e2052000-0000-4000-8000-00000000000a',
   null, 18, 41, 'B-roll on the line', 'Shows the slash command'),
  ('e2050000-0000-4000-8000-00000000000a', 'e2054000-0000-4000-8000-00000000000a', 'e2052000-0000-4000-8000-00000000000a',
   'e2052000-0000-4000-8000-0000000000a1', 0, 22, 'Cut by words', 'Opens on the pain');
select throws_ok($$ insert into public.shorts (user_id, batch_id, source_start, source_end, hook, reason)
  values ('e2050000-0000-4000-8000-00000000000a', 'e2054000-0000-4000-8000-00000000000a', 30, 20, 'x', 'y') $$,
  '23514', null, 'a short ends after it starts');
select throws_ok($$ insert into public.shorts (user_id, batch_id, source_start, source_end, hook, reason)
  values ('e2050000-0000-4000-8000-00000000000a', 'e2054000-0000-4000-8000-00000000000a', 0, 400, 'x', 'y') $$,
  '23514', null, 'a short is short');

-- What each card shows.
select is(public.approval_snapshot('studio_step', 'e2053000-0000-4000-8000-00000000000a'),
  '{"kind":"script","step_id":"e2053000-0000-4000-8000-00000000000a","clip_id":"e2052000-0000-4000-8000-00000000000a","tool":"create_video","title":"How the CMO plans a week","seconds":60,"aspect":"9:16","beats":[{"words":"You recorded the demo.","picture":"Desk, laptop.","motion":"Slow push in."}],"price_credits":6}'::jsonb,
  'card 1 shows the storyboard and the keyframe price, nothing else of the card');
select is(public.approval_snapshot('studio_step', 'e2053000-0000-4000-8000-00000000000b')->>'kind', 'price', 'card 2 is a price card');
select is(public.approval_snapshot('studio_step', 'e2053000-0000-4000-8000-00000000000b')->'keyframes'->0->>'path', 'u/k0.png',
  'the contact sheet holds paths, not signed URLs');
select is((public.approval_snapshot('studio_step', 'e2053000-0000-4000-8000-00000000000b')->>'wait_minutes')::int, 25, 'with the wait');

select is(public.approval_snapshot('short_batch', 'e2054000-0000-4000-8000-00000000000a')->'shorts'->0->>'hook', 'Cut by words',
  'the batch lists its shorts in timeline order');
select is(jsonb_array_length(public.approval_snapshot('short_batch', 'e2054000-0000-4000-8000-00000000000a')->'shorts'), 2,
  'every short of the batch');
select is(public.approval_snapshot('short_batch', 'e2054000-0000-4000-8000-00000000000a')->>'title', 'Editor launch', 'named after its parent');

select is(public.approval_snapshot('editor_project', 'e2052000-0000-4000-8000-00000000000a')->>'render_task_id', null,
  'no render yet: the finished card shows none');
insert into public.tasks (id, user_id, kind, clip_id, job_id, status, request_id, payload, settings_hash, output_path, duration, finished_at)
select 'e2055000-0000-4000-8000-00000000000a', 'e2050000-0000-4000-8000-00000000000a', 'render_document',
  'e2052000-0000-4000-8000-00000000000a', 'e2051000-0000-4000-8000-00000000000a', 'done', gen_random_uuid(), '{}',
  public.editor_document_hash(document), 'u/launch.mp4', 60, now()
from public.editor_projects where clip_id = 'e2052000-0000-4000-8000-00000000000a';
select is(public.approval_snapshot('editor_project', 'e2052000-0000-4000-8000-00000000000a')->>'render_path', 'u/launch.mp4',
  'the render of this document is the finished video');
update public.editor_projects set document = '{"version":1,"stage":{"name":"launch v2"}}'
where clip_id = 'e2052000-0000-4000-8000-00000000000a';
select is(public.approval_snapshot('editor_project', 'e2052000-0000-4000-8000-00000000000a')->>'render_task_id', null,
  'a render of an older document is not this video');

-- Cards raised from the new sources belong to Studio and carry the price.
select public.approval_raise('e2050000-0000-4000-8000-00000000000a', 'studio_step', 'e2053000-0000-4000-8000-00000000000a');
select is((select department || ' ' || kind || ' ' || price_credits from public.approvals
  where ref_kind = 'studio_step' and ref_id = 'e2053000-0000-4000-8000-00000000000a' and status = 'waiting'),
  'studio script 6', 'a step raises a Studio card with its price');
select public.approval_raise('e2050000-0000-4000-8000-00000000000a', 'short_batch', 'e2054000-0000-4000-8000-00000000000a');
select is((select department from public.approvals where ref_kind = 'short_batch' and status = 'waiting'), 'studio',
  'so does a batch');

-- RLS: each founder reads their own.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2050000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.studio_steps), 1, 'a founder reads only their steps');
select is((select count(*)::int from public.shorts) + (select count(*)::int from public.short_batches), 0,
  'and only their shorts');
select throws_ok($$ select public.approval_decide(
  (select id from public.approvals where ref_kind = 'studio_step' limit 1), 'approve', '{}') $$,
  'P0002', null, 'nobody decides another founder''s Studio card');
reset role;

select * from finish();
rollback;
