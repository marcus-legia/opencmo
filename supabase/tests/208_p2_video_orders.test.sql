-- P2 A2 (20261228120000): a video item becomes a `build_video` order; the order runner claims queued Studio orders,
-- approved steps (recording the spend once) and steps whose generations finished, each once; a step stores what runs
-- next and what it waits on; the runner moves orders only through `studio_order_move`.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(29);

select ok(has_function_privilege('service_role', 'public.studio_orders_claim(uuid,integer)', 'execute'), 'the runner claims orders');
select ok(not has_function_privilege('authenticated', 'public.studio_orders_claim(uuid,integer)', 'execute'), 'founders cannot');
select ok(not has_function_privilege('authenticated', 'public.studio_steps_claim(integer)', 'execute'), 'nor claim steps');
select ok(not has_function_privilege('authenticated', 'public.studio_order_move(uuid,text,text,jsonb)', 'execute'), 'nor move orders');
select ok(has_function_privilege('authenticated', 'public.studio_step_finish(uuid,text,text,uuid,jsonb,uuid[])', 'execute'),
  'the adapter reports under the founder''s session');

insert into auth.users (id, email) values ('e2080000-0000-4000-8000-00000000000a', 'a2@test.local');
update public.profiles set weekly_credit_budget = 100 where id = 'e2080000-0000-4000-8000-00000000000a';
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;

-- The plan: one video item → one build_video order under Studio.
with r as (insert into public.cmo_runs (user_id, kind, status) values ('e2080000-0000-4000-8000-00000000000a', 'plan_week', 'running') returning id)
insert into t select 'run', id from r;
select is(public.cmo_plan_week('e2080000-0000-4000-8000-00000000000a', (select id from t where name = 'run'), jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date, 'idea', 'Cut by words'),
  jsonb_build_object('department', 'video', 'platform', 'Shorts', 'day', current_date + 1, 'idea', 'How the CMO plans a week',
    'reason', 'The launch needs a demo'))), 2, 'two calendar items');
insert into t select 'order', id from public.work_orders where kind = 'build_video';
select is((select department || ' ' || status || ' ' || budget_credits from public.work_orders where id = (select id from t where name = 'order')),
  'studio queued 60', 'the video item is a queued Studio order, budgeted');
select is((select brief->>'objective' || ' / ' || (brief->>'angle') || ' / ' || (brief->>'aspect') from public.work_orders where id = (select id from t where name = 'order')),
  'How the CMO plans a week / The launch needs a demo / 9:16', 'its brief comes from the item');
select is(public.studio_work_count(), 1, 'Modal''s sweep sees the work');

-- Claim: once, and moved to running.
select is((select count(*)::int from public.studio_orders_claim()), 1, 'the runner claims the order');
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'running', 'and it runs');
select is((select count(*)::int from public.studio_orders_claim()), 0, 'never twice');
update public.profiles set cmo_paused_at = now() where id = 'e2080000-0000-4000-8000-00000000000a';
insert into t select 'cut', id from public.work_order_create('e2080000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from public.work_orders where parent_id is null and user_id = 'e2080000-0000-4000-8000-00000000000a'), 'cut_shorts', 'Shorts', '{}', 0);
select is((select count(*)::int from public.studio_orders_claim()), 0, 'a paused founder''s orders wait');
update public.profiles set cmo_paused_at = null where id = 'e2080000-0000-4000-8000-00000000000a';

-- buildVideo raised card 1 → the order waits on the founder.
select public.studio_order_move((select id from t where name = 'order'), 'waiting_founder', 'Card 1 waits on you');
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'waiting_founder', 'the order waits on card 1');

insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2081000-0000-4000-8000-00000000000a', 'e2080000-0000-4000-8000-00000000000a', 'https://a', 60, 'done');
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, kind) values
  ('e2082000-0000-4000-8000-00000000000a', 'e2081000-0000-4000-8000-00000000000a', -1, 'How the CMO plans a week', 0, 0, 'blank');
insert into public.studio_steps (id, user_id, clip_id, tool, kind, input, card, price_credits, order_id, status, decision, decided_at) values
  ('e2083000-0000-4000-8000-00000000000a', 'e2080000-0000-4000-8000-00000000000a', 'e2082000-0000-4000-8000-00000000000a', 'create_video',
   'script', '{}', '{"beats":[]}', 6, (select id from t where name = 'order'), 'approved', 'approve', now());

-- The approved step: claimed once, the spend recorded once, the order running.
select is((select count(*)::int from public.studio_steps_claim()), 1, 'the runner claims the approved step');
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'running', 'the order runs again');
select is((select spent_credits from public.work_orders where id = (select id from t where name = 'order')), 6, 'the card''s price is recorded on the order');
select is((select count(*)::int from public.studio_steps_claim()), 0, 'a claimed step is not claimed again');
update public.studio_steps set claimed_at = now() - interval '11 minutes' where id = 'e2083000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.studio_steps_claim()), 1, 'a crashed runner''s claim is taken again');
select is((select spent_credits from public.work_orders where id = (select id from t where name = 'order')), 6, 'without spending twice');

-- decide → keyframes queued: the step stores card 2 and waits on them.
insert into public.generations (id, user_id, job_id, clip_id, kind, model, spec, spec_hash, credits_reserved, status) values
  ('e2084000-0000-4000-8000-000000000001', 'e2080000-0000-4000-8000-00000000000a', 'e2081000-0000-4000-8000-00000000000a',
   'e2082000-0000-4000-8000-00000000000a', 'image', (select id from public.ai_models where kind = 'image' order by id limit 1), '{}', repeat('a', 64), 1, 'running'),
  ('e2084000-0000-4000-8000-000000000002', 'e2080000-0000-4000-8000-00000000000a', 'e2081000-0000-4000-8000-00000000000a',
   'e2082000-0000-4000-8000-00000000000a', 'image', (select id from public.ai_models where kind = 'image' order by id limit 1), '{}', repeat('b', 64), 1, 'queued');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2080000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((public.studio_step_finish('e2083000-0000-4000-8000-00000000000a', 'running', null, null,
  '{"tool":"animate_video","input":{"keyframes":[]}}', array['e2084000-0000-4000-8000-000000000001', 'e2084000-0000-4000-8000-000000000002']::uuid[])).next->>'tool',
  'animate_video', 'the step keeps what runs next');
select throws_ok($$ select public.studio_step_finish('e2083000-0000-4000-8000-00000000000a', 'running', null, null,
  '{"tool":"render"}', array[gen_random_uuid()]) $$, '22023', null, 'a step waits only on the founder''s own generations');
reset role;
select public.studio_order_move((select id from t where name = 'order'), 'waiting_order', 'Making the keyframes');
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'waiting_order', 'the order waits on its generations');

select is((select count(*)::int from public.studio_steps_ready()), 0, 'not ready while a keyframe is being made');
update public.generations set status = 'done' where id = 'e2084000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.studio_steps_ready()), 0, 'nor while one is still queued');
update public.generations set status = 'failed' where id = 'e2084000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.studio_steps_ready()), 1, 'ready once every generation finished (the runner reads which failed)');
select is((select status from public.studio_steps where id = 'e2083000-0000-4000-8000-00000000000a'), 'done', 'the step is done');
select is((select count(*)::int from public.studio_steps_ready()), 0, 'and its next runs once');

-- Card 2 raised: back to the founder, through running.
select public.studio_order_move((select id from t where name = 'order'), 'waiting_founder', 'Card 2 waits on you');
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'waiting_founder',
  'from waiting on generations to waiting on the founder');

select * from finish();
rollback;
