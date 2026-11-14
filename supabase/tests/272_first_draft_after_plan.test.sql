-- Code review of cmo-review-2 (20270111220000), R4: the onboarding plan's completion queues the first draft, whoever
-- ran the plan (the onboarding route or Modal's sweep). A plan in the founder's Claude inbox, another plan, and a
-- refused draft do not.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

insert into auth.users (id, email) values
  ('e2720000-0000-4000-8000-00000000000a', 'fd-a@test.local'),
  ('e2720000-0000-4000-8000-00000000000b', 'fd-b@test.local');
insert into public.credit_ledger (user_id, delta, reason) values
  ('e2720000-0000-4000-8000-00000000000a', 100, 'test grant'),
  ('e2720000-0000-4000-8000-00000000000b', 100, 'test grant');

create temp table t (name text primary key, id uuid) on commit drop;
insert into t select 'onboarding', id from public.cmo_enqueue('e2720000-0000-4000-8000-00000000000a', 'plan_week', '{"source":"onboarding"}');
insert into t select 'monday', id from public.cmo_enqueue('e2720000-0000-4000-8000-00000000000b', 'plan_week', '{"source":"loop"}');

-- As the sweep would: claimed, then completed.
update public.cmo_runs set status = 'running' where id in (select id from t);
update public.cmo_runs set status = 'done' where id = (select id from t where name = 'onboarding');
select is((select count(*)::int from public.cmo_runs where user_id = 'e2720000-0000-4000-8000-00000000000a' and kind = 'post_draft'
  and status = 'queued' and input->>'source' = 'onboarding'), 1, 'the onboarding plan''s completion queues the first draft');

update public.cmo_runs set status = 'done' where id = (select id from t where name = 'monday');
select is((select count(*)::int from public.cmo_runs where user_id = 'e2720000-0000-4000-8000-00000000000b' and kind = 'post_draft'), 0,
  'another plan does not');

-- Done again (a replay): still one draft.
update public.cmo_runs set status = 'running' where id = (select id from t where name = 'onboarding');
update public.cmo_runs set status = 'done' where id = (select id from t where name = 'onboarding');
select is((select count(*)::int from public.cmo_runs where user_id = 'e2720000-0000-4000-8000-00000000000a' and kind = 'post_draft'), 1,
  'a second completion does not queue a second draft');

-- A plan that ended in the old Claude inbox (done with `waiting_for`, before 20270124010000) wrote no week: no draft.
delete from public.cmo_runs where user_id = 'e2720000-0000-4000-8000-00000000000b';
update public.profiles set plan = 'creator' where id = 'e2720000-0000-4000-8000-00000000000b';
insert into t select 'inbox', id from public.cmo_enqueue('e2720000-0000-4000-8000-00000000000b', 'plan_week', '{"source":"onboarding"}');
update public.cmo_runs set status = 'running' where id = (select id from t where name = 'inbox');
update public.cmo_runs set status = 'done', output = '{"inbox_id":"x","waiting_for":"plan_week"}' where id = (select id from t where name = 'inbox');
select is((select count(*)::int from public.cmo_runs where user_id = 'e2720000-0000-4000-8000-00000000000b' and kind = 'post_draft'), 0,
  'a plan left in the old Claude inbox does not');

-- A paused CMO refuses the draft; the plan still ends done.
delete from public.cmo_runs where user_id = 'e2720000-0000-4000-8000-00000000000a';
insert into t select 'paused', id from public.cmo_enqueue('e2720000-0000-4000-8000-00000000000a', 'plan_week', '{"source":"onboarding"}');
update public.cmo_runs set status = 'running' where id = (select id from t where name = 'paused');
update public.profiles set cmo_paused_at = now() where id = 'e2720000-0000-4000-8000-00000000000a';
update public.cmo_runs set status = 'done' where id = (select id from t where name = 'paused');
select is((select status from public.cmo_runs where id = (select id from t where name = 'paused')) || ' / '
  || (select count(*) from public.cmo_runs where user_id = 'e2720000-0000-4000-8000-00000000000a' and kind = 'post_draft'),
  'done / 0', 'a refused draft does not undo the plan');

select * from finish();
rollback;
