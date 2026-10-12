-- 20261118090000: a /video shot that continues the previous one waits for it, starts when it is
-- done, and fails (refunded) when it fails or is cancelled, down the whole chain.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(22);

insert into auth.users (id, email) values
  ('e1480000-0000-4000-8000-00000000000a', 'chain-a@test.local'),
  ('e1480000-0000-4000-8000-00000000000b', 'chain-b@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1481000-0000-4000-8000-00000000000a', 'e1480000-0000-4000-8000-00000000000a', 'https://a', 600, 'done'),
  ('e1481000-0000-4000-8000-00000000000c', 'e1480000-0000-4000-8000-00000000000a', 'https://c', 600, 'done'),
  ('e1481000-0000-4000-8000-00000000000b', 'e1480000-0000-4000-8000-00000000000b', 'https://b', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1480000-0000-4000-8000-00000000000a', 100, 'test grant'),
  ('e1480000-0000-4000-8000-00000000000b', 100, 'test grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1480000-0000-4000-8000-00000000000a"}';

-- ================================================================ spec
select throws_ok(
  $$ select public.create_generation('e1481000-0000-4000-8000-00000000000a', null, 'fake-video',
       '{"prompt":"x","aspectRatio":"9:16","duration":5,"after":"nope"}', repeat('1', 64), gen_random_uuid()) $$,
  '22023', 'Invalid generation request.', 'after must be a spec hash'
);
select throws_ok(
  $$ select public.create_generation('e1481000-0000-4000-8000-00000000000a', null, 'fake-image',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '1:1', 'after', repeat('a', 64)), repeat('1', 64), gen_random_uuid()) $$,
  '22023', 'This request has settings the model does not take.', 'only video models that start from a frame'
);
select throws_ok(
  $$ select public.create_generation('e1481000-0000-4000-8000-00000000000a', null, 'fake-video',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '9:16', 'duration', 5, 'after', repeat('a', 64), 'startImage', 'x/y.png'), repeat('1', 64), gen_random_uuid()) $$,
  '22023', 'A shot that continues the previous one cannot also start from an image.', 'not with a start image'
);
select throws_ok(
  $$ select public.create_generation('e1481000-0000-4000-8000-00000000000a', null, 'fake-video',
       jsonb_build_object('prompt', 'x', 'aspectRatio', '9:16', 'duration', 5, 'after', repeat('a', 64)), repeat('1', 64), gen_random_uuid()) $$,
  '22023', 'Start the shot before this one first.', 'the parent must exist'
);

-- ================================================================ chain: parent → child → grandchild
create temporary table chain (name text, r jsonb);
insert into chain select 'parent', public.create_generation('e1481000-0000-4000-8000-00000000000a', null, 'fake-video',
  '{"prompt":"a","aspectRatio":"9:16","duration":5,"seed":1}', repeat('a', 64), gen_random_uuid());
insert into chain select 'child', public.create_generation('e1481000-0000-4000-8000-00000000000a', null, 'fake-video',
  jsonb_build_object('prompt', 'b', 'aspectRatio', '9:16', 'duration', 5, 'seed', 2, 'after', repeat('a', 64)), repeat('b', 64), gen_random_uuid());
insert into chain select 'grandchild', public.create_generation('e1481000-0000-4000-8000-00000000000a', null, 'fake-video',
  jsonb_build_object('prompt', 'c', 'aspectRatio', '9:16', 'duration', 5, 'seed', 3, 'after', repeat('b', 64)), repeat('c', 64), gen_random_uuid());
create temporary table ids as
  select name, (r->'generation'->>'id')::uuid as gen, (r->'generation'->>'task_id')::uuid as task from chain;
select is((select after_id from public.generations where id = (select gen from ids where name = 'child')),
  (select gen from ids where name = 'parent'), 'the child points at its parent');
select is((select status from public.tasks where id = (select task from ids where name = 'child')), 'awaiting_input', 'the child waits');
select is((select status from public.generations where id = (select gen from ids where name = 'child')), 'queued', 'and shows as queued');
select is(public.credit_balance('e1480000-0000-4000-8000-00000000000a'), 85, 'every shot is held up front');
select throws_ok(
  $$ select public.create_generation('e1481000-0000-4000-8000-00000000000c', null, 'fake-video',
       jsonb_build_object('prompt', 'd', 'aspectRatio', '9:16', 'duration', 5, 'after', repeat('a', 64)), repeat('d', 64), gen_random_uuid()) $$,
  '22023', 'Start the shot before this one first.', 'a parent in another project does not count'
);

-- ================================================================ worker: waiting tasks are never claimed
reset role;
create temporary table claimed as select * from public.claim_next_task(array['generate'], 300);
select is((select id from claimed), (select task from ids where name = 'parent'), 'only the parent is claimed');
select is((select count(*)::int from public.claim_next_task(array['generate'], 300)), 0, 'the waiting shots are not');
select is((select count(*)::int from public.claim_task((select task from ids where name = 'child'), 300)), 0, 'not even by id');

select ok(public.complete_generation((select id from claimed), (select attempt_id from claimed),
  'e1480000-0000-4000-8000-00000000000a/e1481000-0000-4000-8000-00000000000a/gen-' || (select gen from ids where name = 'parent') || '.mp4',
  'a.mp4', 5, 1080, 1920, 5), 'the parent completes');
select is((select status from public.tasks where id = (select task from ids where name = 'child')), 'queued', 'its child is released');
select is((select status from public.tasks where id = (select task from ids where name = 'grandchild')), 'awaiting_input', 'the grandchild still waits');

-- ================================================================ failure cascades and refunds
create temporary table claimed2 as select * from public.claim_next_task(array['generate'], 300);
select is((select id from claimed2), (select task from ids where name = 'child'), 'the child is claimed');
select ok(public.fail_task((select id from claimed2), (select attempt_id from claimed2), 'Provider error.'), 'the child fails');
select is((select status from public.generations where id = (select gen from ids where name = 'grandchild')), 'failed', 'the grandchild fails with it');
select is((select error from public.generations where id = (select gen from ids where name = 'grandchild')),
  'The shot before this one did not finish. Your credits were refunded.', 'with a clear reason');
select is(public.credit_balance('e1480000-0000-4000-8000-00000000000a'), 95, 'both are refunded; the parent is paid');

-- ================================================================ cancel a waiting shot
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1480000-0000-4000-8000-00000000000b"}';
create temporary table other (name text, r jsonb);
insert into other select 'p', public.create_generation('e1481000-0000-4000-8000-00000000000b', null, 'fake-video',
  '{"prompt":"p","aspectRatio":"9:16","duration":5}', repeat('e', 64), gen_random_uuid());
insert into other select 'c', public.create_generation('e1481000-0000-4000-8000-00000000000b', null, 'fake-video',
  jsonb_build_object('prompt', 'q', 'aspectRatio', '9:16', 'duration', 5, 'after', repeat('e', 64)), repeat('f', 64), gen_random_uuid());
select is((public.cancel_generation((select (r->'generation'->>'id')::uuid from other where name = 'c'))->>'status'), 'cancelled', 'a waiting shot can be cancelled');
select is(public.credit_balance('e1480000-0000-4000-8000-00000000000b'), 95, 'and is refunded');

select * from finish();
rollback;
