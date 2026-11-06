-- Charge before running, phase 3 (20270109030000): a shot starts and ends on keyframes still being made.
--
--   spec    — startAfter / endAfter are spec hashes, one frame per end, video models with first/last frames only
--   wait    — the shot waits until every keyframe it names is done, and is released then
--   cascade — a failed keyframe fails and refunds the shots that wait on it
--   scope   — only an image of the same project and owner counts as a keyframe
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select no_plan();

insert into auth.users (id, email) values
  ('e2540000-0000-4000-8000-00000000000a', 'kf-a@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2541000-0000-4000-8000-00000000000a', 'e2540000-0000-4000-8000-00000000000a', 'https://a', 600, 'done'),
  ('e2541000-0000-4000-8000-00000000000c', 'e2540000-0000-4000-8000-00000000000a', 'https://c', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e2540000-0000-4000-8000-00000000000a', 100, 'test grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2540000-0000-4000-8000-00000000000a"}';

-- ================================================================ spec
select throws_ok(
  $$ select public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-image',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '9:16', 'startAfter', repeat('a', 64)), repeat('1', 64), gen_random_uuid()) $$,
  '22023', 'This request has settings the model does not take.', 'only video models take keyframes'
);
select throws_ok(
  $$ select public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-video',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '9:16', 'duration', 5, 'startAfter', 'nope'), repeat('1', 64), gen_random_uuid()) $$,
  '22023', 'Invalid generation request.', 'a keyframe is a spec hash'
);
select throws_ok(
  $$ select public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-video',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '9:16', 'duration', 5, 'startAfter', repeat('a', 64), 'after', repeat('b', 64)), repeat('1', 64), gen_random_uuid()) $$,
  '22023', 'A shot starts from one frame only.', 'not with after'
);
select throws_ok(
  $$ select public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-video',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '9:16', 'duration', 5, 'endAfter', repeat('a', 64), 'endImage', 'x/y.png'), repeat('1', 64), gen_random_uuid()) $$,
  '22023', 'A shot ends on one frame only.', 'not with an end image'
);
select throws_ok(
  $$ select public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-video',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '9:16', 'duration', 5, 'startAfter', repeat('a', 64)), repeat('1', 64), gen_random_uuid()) $$,
  '22023', 'Start the keyframes of this shot first.', 'the keyframe must exist'
);

-- ================================================================ two keyframes, one shot between them
create temporary table made (name text, r jsonb);
insert into made select 'k1', public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-image',
  '{"prompt":"a desk at dawn","aspectRatio":"9:16","seed":1}', repeat('a', 64), gen_random_uuid());
insert into made select 'k2', public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-image',
  '{"prompt":"the desk at noon","aspectRatio":"9:16","seed":2}', repeat('b', 64), gen_random_uuid());
insert into made select 'shot', public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-video',
  jsonb_build_object('prompt', 'the light moves', 'aspectRatio', '9:16', 'duration', 5, 'seed', 3,
                     'startAfter', repeat('a', 64), 'endAfter', repeat('b', 64)), repeat('c', 64), gen_random_uuid());
create temporary table ids as
  select name, (r->'generation'->>'id')::uuid as gen, (r->'generation'->>'task_id')::uuid as task from made;
grant select on ids to authenticated;
select is((select start_after_id from public.generations where id = (select gen from ids where name = 'shot')),
  (select gen from ids where name = 'k1'), 'the shot points at its first keyframe');
select is((select end_after_id from public.generations where id = (select gen from ids where name = 'shot')),
  (select gen from ids where name = 'k2'), 'and at its last');
select is((select status from public.tasks where id = (select task from ids where name = 'shot')), 'awaiting_input', 'the shot waits');
select is(public.credit_balance('e2540000-0000-4000-8000-00000000000a'), 93, 'everything is held up front (1 + 1 + 5)');
select throws_ok(
  $$ select public.create_generation('e2541000-0000-4000-8000-00000000000c', null, 'fake-video',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '9:16', 'duration', 5, 'startAfter', repeat('a', 64)), repeat('d', 64), gen_random_uuid()) $$,
  '22023', 'Start the keyframes of this shot first.', 'a keyframe of another project does not count'
);
select throws_ok(
  $$ select public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-video',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '9:16', 'duration', 5, 'startAfter', repeat('c', 64)), repeat('d', 64), gen_random_uuid()) $$,
  '22023', 'Start the keyframes of this shot first.', 'a video is not a keyframe'
);

-- ================================================================ released only when both keyframes are done
reset role;
create temporary table c1 as select * from public.claim_task((select task from ids where name = 'k1'), 300);
select ok(public.complete_generation((select id from c1), (select attempt_id from c1),
  'e2540000-0000-4000-8000-00000000000a/e2541000-0000-4000-8000-00000000000a/gen-' || (select gen from ids where name = 'k1') || '.png',
  'k1.png', null, 1080, 1920, 1), 'the first keyframe completes');
select is((select status from public.tasks where id = (select task from ids where name = 'shot')), 'awaiting_input', 'the shot still waits for the second');
select is((select count(*)::int from public.claim_task((select task from ids where name = 'shot'), 300)), 0, 'and cannot be claimed');
create temporary table c2 as select * from public.claim_task((select task from ids where name = 'k2'), 300);
select ok(public.complete_generation((select id from c2), (select attempt_id from c2),
  'e2540000-0000-4000-8000-00000000000a/e2541000-0000-4000-8000-00000000000a/gen-' || (select gen from ids where name = 'k2') || '.png',
  'k2.png', null, 1080, 1920, 1), 'the second keyframe completes');
select is((select status from public.tasks where id = (select task from ids where name = 'shot')), 'queued', 'now the shot is released');

-- ================================================================ a failed keyframe fails its shots
set local role authenticated;
create temporary table made2 (name text, r jsonb);
insert into made2 select 'k3', public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-image',
  '{"prompt":"a mug","aspectRatio":"9:16","seed":4}', repeat('e', 64), gen_random_uuid());
insert into made2 select 'shot2', public.create_generation('e2541000-0000-4000-8000-00000000000a', null, 'fake-video',
  jsonb_build_object('prompt', 'steam rises', 'aspectRatio', '9:16', 'duration', 5, 'seed', 5, 'startAfter', repeat('e', 64)),
  repeat('f', 64), gen_random_uuid());
create temporary table ids2 as
  select name, (r->'generation'->>'id')::uuid as gen, (r->'generation'->>'task_id')::uuid as task from made2;
grant select on ids2 to authenticated;
select is(public.credit_balance('e2540000-0000-4000-8000-00000000000a'), 87, 'held: 1 + 5 more');
reset role;
create temporary table c3 as select * from public.claim_task((select task from ids2 where name = 'k3'), 300);
select ok(public.fail_task((select id from c3), (select attempt_id from c3), 'Provider error.'), 'the keyframe fails');
select is((select status from public.generations where id = (select gen from ids2 where name = 'shot2')), 'failed', 'the shot on it fails too');
select is((select error from public.generations where id = (select gen from ids2 where name = 'shot2')),
  'A keyframe of this shot did not finish. Your credits were refunded.', 'with a clear reason');
select is(public.credit_balance('e2540000-0000-4000-8000-00000000000a'), 93, 'both are refunded');

select * from finish();
rollback;
