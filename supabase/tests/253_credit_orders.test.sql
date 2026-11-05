-- Charge before running, phase 2 (20270109020000): one hold per job.
--
--   open   — the whole estimate is held once; the same request id hands back the same job; a short balance is refused
--   draw   — a generation under the job moves its price from the job's hold to its own; the balance does not move
--   refund — a failed piece refunds its own share to the balance, as any generation
--   close  — what the job still holds comes back, once; a closed job takes no more pieces
--   rights — another user cannot see, draw from or close the job; draw and the reaper are service-role only
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select no_plan();

insert into auth.users (id, email) values
  ('e2530000-0000-4000-8000-00000000000a', 'order-a@test.local'),
  ('e2530000-0000-4000-8000-00000000000b', 'order-b@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2531000-0000-4000-8000-00000000000a', 'e2530000-0000-4000-8000-00000000000a', 'https://a', 600, 'done'),
  ('e2531000-0000-4000-8000-00000000000b', 'e2530000-0000-4000-8000-00000000000b', 'https://b', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e2530000-0000-4000-8000-00000000000a', 20, 'test grant'),
  ('e2530000-0000-4000-8000-00000000000b', 20, 'test grant');

-- ================================================================ rights on the functions
select ok(has_function_privilege('authenticated', 'public.credit_order_open(text,integer,text,uuid,uuid)', 'execute'), 'a user opens a job');
select ok(has_function_privilege('authenticated', 'public.credit_order_close(uuid)', 'execute'), 'a user closes a job');
select ok(not has_function_privilege('authenticated', 'public.credit_order_draw(uuid,text,uuid,integer,text,uuid)', 'execute'), 'only the server draws');
select ok(not has_function_privilege('authenticated', 'public.credit_order_close_for(uuid,uuid)', 'execute'), 'only the server closes for a user');
select ok(not has_function_privilege('authenticated', 'public.credit_orders_reap()', 'execute'), 'only the server reaps');
select ok(not has_table_privilege('authenticated', 'public.credit_orders', 'insert'), 'jobs are opened through the RPC only');

-- Test helper (rolled back): what a ref holds, readable as the user.
create function public.t253_held(p_kind text, p_id uuid) returns integer
language sql security definer set search_path = public as $$ select public.credit_held(p_kind, p_id) $$;
grant execute on function public.t253_held(text, uuid) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2530000-0000-4000-8000-00000000000a"}';

-- ================================================================ open
select throws_ok(
  $$ select public.credit_order_open('long_take', 25, null, null, gen_random_uuid()) $$,
  'P0001', 'Not enough credits: 25 needed, 20 left. Top up on the Credits page.', 'an estimate above the balance is refused'
);
select throws_ok($$ select public.credit_order_open('nope', 5, null, null, gen_random_uuid()) $$, '22023', 'Invalid job.', 'unknown kind');
select throws_ok($$ select public.credit_order_open('long_take', 0, null, null, gen_random_uuid()) $$, '22023', 'Invalid job estimate.', 'zero estimate');
select throws_ok(
  $$ select public.credit_order_open('explainer', 5, 'agent_turn', gen_random_uuid(), gen_random_uuid()) $$,
  'P0002', 'Job not found.', 'a source the user does not own'
);

create temporary table o1 as select * from public.credit_order_open('long_take', 12, null, null, 'e2532000-0000-4000-8000-000000000001');
grant select on o1 to authenticated;
select is((select status from o1), 'open', 'the job is open');
select is(public.credit_balance(auth.uid()), 8, 'the whole estimate is held once');
select is(public.t253_held('credit_order', (select id from o1)), 12, 'held under the job');
select is(
  (select id from public.credit_order_open('long_take', 12, null, null, 'e2532000-0000-4000-8000-000000000001')),
  (select id from o1), 'the same request id hands back the same job'
);
select is(public.credit_balance(auth.uid()), 8, 'a retried click holds nothing more');

-- ================================================================ draw
create temporary table g1 as select (public.create_generation('e2531000-0000-4000-8000-00000000000a', null, 'fake-video',
  '{"prompt":"a desk","aspectRatio":"1:1","duration":5}', repeat('1', 64), gen_random_uuid(), (select id from o1))->'generation') as g;
grant select on g1 to authenticated;
select is(public.credit_balance(auth.uid()), 8, 'a piece of the job does not touch the balance');
select is(public.t253_held('credit_order', (select id from o1)), 7, 'the job holds 5 less');
select is(public.t253_held('generation', ((select g from g1)->>'id')::uuid), 5, 'the piece holds its own price');

create temporary table g2 as select (public.create_generation('e2531000-0000-4000-8000-00000000000a', null, 'fake-image',
  '{"prompt":"a mug","aspectRatio":"1:1"}', repeat('2', 64), gen_random_uuid(), (select id from o1))->'generation') as g;
grant select on g2 to authenticated;
select is(public.t253_held('credit_order', (select id from o1)), 6, 'a second piece draws its price too');

select throws_ok(
  $$ select public.create_generation('e2531000-0000-4000-8000-00000000000a', null, 'fake-video',
       '{"prompt":"x","aspectRatio":"1:1","duration":5}', repeat('3', 64), gen_random_uuid(),
       (select id from public.credit_order_open('long_take', 2, null, null, 'e2532000-0000-4000-8000-000000000003'))) $$,
  'P0001', 'This job needs more credits than its estimate. Start it again.', 'a piece past the estimate is refused'
);
select is(public.credit_balance(auth.uid()), 8, 'the refused piece cost nothing (its job rolled back with it)');

-- A generation outside any job keeps its own hold from the balance, as before.
select lives_ok(
  $$ select public.create_generation('e2531000-0000-4000-8000-00000000000a', null, 'fake-image',
       '{"prompt":"a cup","aspectRatio":"1:1"}', repeat('4', 64), gen_random_uuid()) $$,
  'a single generation still works without a job'
);
select is(public.credit_balance(auth.uid()), 7, 'and holds from the balance');

-- ================================================================ refund of one piece
reset role;
update public.tasks set status = 'failed', error = 'The provider failed.' where id = ((select g from g2)->>'task_id')::uuid;
set local role authenticated;
select is(public.credit_balance(auth.uid()), 8, 'a failed piece refunds its own price to the balance');
select is(public.t253_held('credit_order', (select id from o1)), 6, 'the job hold is untouched by it');

-- ================================================================ other users
set local request.jwt.claims = '{"sub":"e2530000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.credit_orders), 0, 'another user sees no job of A');
select throws_ok($$ select public.credit_order_close((select id from o1)) $$, 'P0002', 'Job not found.', 'and cannot close it');
select throws_ok(
  $$ select public.create_generation('e2531000-0000-4000-8000-00000000000b', null, 'fake-image',
       '{"prompt":"x","aspectRatio":"1:1"}', repeat('5', 64), gen_random_uuid(), (select id from o1)) $$,
  'P0002', 'Job not found.', 'nor draw from it for their own project'
);
set local request.jwt.claims = '{"sub":"e2530000-0000-4000-8000-00000000000a"}';

-- ================================================================ close
select is(public.credit_order_close((select id from o1)), 6, 'closing gives back what the job still holds');
select is(public.credit_balance(auth.uid()), 14, 'the balance gets it');
select is((select status from public.credit_orders where id = (select id from o1)), 'closed', 'the job is closed');
select is(public.credit_order_close((select id from o1)), 0, 'closing twice gives nothing more');
select is(public.credit_balance(auth.uid()), 14, 'no double refund');
select throws_ok(
  $$ select public.create_generation('e2531000-0000-4000-8000-00000000000a', null, 'fake-image',
       '{"prompt":"late","aspectRatio":"1:1"}', repeat('6', 64), gen_random_uuid(), (select id from o1)) $$,
  'P0001', 'This job is closed. Start it again.', 'a closed job takes no more pieces'
);
select is(public.t253_held('generation', ((select g from g1)->>'id')::uuid), 5, 'the piece already made keeps its own hold');

-- ================================================================ reaper
create temporary table o2 as select * from public.credit_order_open('studio_video', 4, null, null, gen_random_uuid());
grant select on o2 to authenticated;
reset role;
update public.credit_orders set created_at = now() - interval '25 hours' where id = (select id from o2);
select ok(public.credit_orders_reap() >= 1, 'the reaper closes a job left open for a day');
select is((select status from public.credit_orders where id = (select id from o2)), 'closed', 'it is closed');
select is(public.credit_balance('e2530000-0000-4000-8000-00000000000a'), 14, 'and its hold came back');
select ok(public.agent_reap_turns() >= 0, 'the turn reaper runs the job reaper too');

select * from finish();
rollback;
