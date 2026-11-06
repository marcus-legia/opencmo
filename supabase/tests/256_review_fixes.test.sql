-- 20270110010000: fixes from the review of the charge-before-running work (2026-11-06).
--
--   lock    — create_generation takes the credit owner before any generation row, as complete_generation does
--   subject — an explainer job names the clip it was approved for
--   cap     — a turn that opened an explainer job pays at most agent_3d_hold_credits() for its tokens
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

grant execute on function public.agent_record_usage_for(uuid, uuid, text, integer, integer, integer, integer) to authenticated;

select no_plan();

-- ================================================================ lock order
select ok(
  pg_get_functiondef('public.create_generation(uuid,uuid,text,jsonb,text,uuid,uuid)'::regprocedure)
    ~* 'lock_credit_owner\(v_user\);.*for update.*for update.*for update',
  'create_generation: the credit owner before the parent and keyframe rows'
);
select ok(
  position('lock_credit_owner(v_user)' in pg_get_functiondef('public.create_generation(uuid,uuid,text,jsonb,text,uuid,uuid)'::regprocedure))
    < position('for update' in pg_get_functiondef('public.create_generation(uuid,uuid,text,jsonb,text,uuid,uuid)'::regprocedure)),
  'and before the first row lock'
);

insert into auth.users (id, email) values ('e2560000-0000-4000-8000-00000000000a', 'review-a@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2561000-0000-4000-8000-00000000000a', 'e2560000-0000-4000-8000-00000000000a', 'storage://e2560000-0000-4000-8000-00000000000a/a.mp4', 600, 'done');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e2562000-0000-4000-8000-00000000000a', 'e2561000-0000-4000-8000-00000000000a', 0, 1, 20, 1, 20);
insert into public.credit_ledger(user_id, delta, reason) values ('e2560000-0000-4000-8000-00000000000a', 200, 'test grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2560000-0000-4000-8000-00000000000a"}';

-- ================================================================ subject
select ok(has_function_privilege('authenticated', 'public.credit_order_open(text,integer,text,uuid,uuid,text)', 'execute'), 'a user opens a job with a subject');
create temporary table s as select * from public.agent_open_session('e2562000-0000-4000-8000-00000000000a', 'claude-sonnet-5-5');
grant select on s to authenticated;
create temporary table t1 as select * from public.agent_begin_turn((select id from s), 'Explain vaccines', '[{"text":"Explain vaccines"}]');
grant select on t1 to authenticated;

create temporary table o1 as select * from public.credit_order_open('explainer', 9, 'agent_turn', (select id from t1), gen_random_uuid(), 'clip:e2562000-0000-4000-8000-00000000000a');
grant select on o1 to authenticated;
select is((select subject from o1), 'clip:e2562000-0000-4000-8000-00000000000a', 'the job names its clip');
select is(
  (select count(*)::int from public.credit_orders where kind = 'explainer' and status = 'open' and subject = 'clip:other'),
  0, 'another clip finds no job to draw from'
);
select throws_ok(
  $$ select public.credit_order_open('explainer', 5, null, null, gen_random_uuid(), repeat('x', 201)) $$,
  '22023', 'Invalid job.', 'a subject is short'
);
select lives_ok(
  $$ select public.credit_order_open('long_take', 5, null, null, gen_random_uuid()) $$,
  'callers without a subject still open a job'
);

-- ================================================================ cap
-- 50M Sonnet input tokens are far more than 20 credits.
select lives_ok($$ select public.agent_record_usage_for(auth.uid(), (select id from t1), 'claude-sonnet-5-5', 50000000, 0, 0, 0) $$,
  'the explainer turn records a long run of writing and previews');
create temporary table before_close as select public.credit_balance(auth.uid()) + (select hold_credits from public.agent_turns where id = (select id from t1)) as free;
grant select on before_close to authenticated;
reset role;
select is((select credits from public.agent_close_turn((select id from t1), 'done', null)), public.agent_3d_hold_credits(),
  'its tokens cost at most what the card quoted');
select is(public.credit_balance('e2560000-0000-4000-8000-00000000000a'), (select free from before_close) - public.agent_3d_hold_credits(),
  'the balance pays exactly that');
set local role authenticated;
select lives_ok($$ select public.agent_record_usage_for(auth.uid(), (select id from t1), 'claude-sonnet-5-5', 50000000, 0, 0, 0) $$,
  'usage recorded after the close');
select is((select credits from public.agent_turns where id = (select id from t1)), public.agent_3d_hold_credits(),
  'is capped the same way');

-- A turn without an explainer job is billed in full, as before.
create temporary table t2 as select * from public.agent_begin_turn((select id from s), 'Write a long script', '[{"text":"Write a long script"}]');
grant select on t2 to authenticated;
select lives_ok($$ select public.agent_record_usage_for(auth.uid(), (select id from t2), 'claude-sonnet-5-5', 5000000, 0, 0, 0) $$,
  'an ordinary turn records its usage');
reset role;
select ok((select credits from public.agent_close_turn((select id from t2), 'done', null)) > public.agent_3d_hold_credits(),
  'and pays all of it');

select * from finish();
rollback;
