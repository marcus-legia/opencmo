-- cmo-review B2.1 (20270106050000): the Monday plan raises one plan card; approving it with dropped items removes
-- them and cancels their orders; skip changes nothing; a replan replaces the card.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

select ok(not has_function_privilege('authenticated', 'public.plan_card_decide(public.approvals,text,jsonb)', 'execute'), 'decided only through approval_decide');
select ok(not has_function_privilege('authenticated', 'public.plan_snapshot(uuid)', 'execute'), 'snapshots are internal');

insert into auth.users (id, email) values ('e2490000-0000-4000-8000-00000000000a', 'b21@test.local');
update public.profiles set weekly_credit_budget = 100, credit_balance = 50 where id = 'e2490000-0000-4000-8000-00000000000a';
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;
with r as (insert into public.cmo_runs (user_id, kind, status) values ('e2490000-0000-4000-8000-00000000000a', 'plan_week', 'running') returning id)
insert into t select 'run', id from r;
select public.cmo_plan_week('e2490000-0000-4000-8000-00000000000a', (select id from t where name = 'run'), jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date, 'idea', 'Cut by words', 'reason', 'Pillar one'),
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', date_trunc('week', current_date)::date + 6, 'idea', 'Captions in one click', 'reason', 'Pillar two'),
  jsonb_build_object('department', 'video', 'platform', 'Shorts', 'day', date_trunc('week', current_date)::date + 6, 'idea', 'How the CMO plans a week')));

insert into t select 'card', id from public.approvals where user_id = 'e2490000-0000-4000-8000-00000000000a' and kind = 'plan' and status = 'waiting';
select is((select count(*)::int from t where name = 'card'), 1, 'the plan raises one plan card');
select is((select department || ' ' || ref_kind || ' ' || jsonb_array_length(snapshot->'items') from public.approvals where id = (select id from t where name = 'card')),
  'brain work_order 3', 'the brain''s card, with the week''s three items');

insert into t select 'video_item', id from public.content_items where user_id = 'e2490000-0000-4000-8000-00000000000a' and department = 'video';
insert into t select 'video_order', id from public.work_orders where item_id = (select id from t where name = 'video_item') and kind = 'write_video_brief';

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2490000-0000-4000-8000-00000000000a","role":"authenticated"}';

select throws_ok(format($$ select public.approval_decide(%L, 'approve', jsonb_build_object('content_hash', %L, 'drop', jsonb_build_array(gen_random_uuid()))) $$,
  (select id from t where name = 'card'), (select content_hash from public.approvals where id = (select id from t where name = 'card'))),
  '22023', 'That item is not on this card.', 'only items on the card can be dropped');
select is((select status from public.approvals where id = (select id from t where name = 'card')), 'waiting', 'a refused decision leaves the card open');

select is((public.approval_decide((select id from t where name = 'card'), 'approve', jsonb_build_object(
  'content_hash', (select content_hash from public.approvals where id = (select id from t where name = 'card')),
  'drop', jsonb_build_array((select id from t where name = 'video_item'))))).status, 'edited', 'approving with a drop is an edit');

reset role;
select is((select count(*)::int from public.content_items where id = (select id from t where name = 'video_item')), 0, 'the dropped item is gone');
select is((select status from public.work_orders where id = (select id from t where name = 'video_order')), 'cancelled', 'and its script order is cancelled');
select is((select count(*)::int from public.approvals where user_id = 'e2490000-0000-4000-8000-00000000000a' and kind = 'plan' and status = 'waiting'),
  0, 'the resync raises no new plan card');
select is((select count(*)::int from public.work_orders where user_id = 'e2490000-0000-4000-8000-00000000000a' and kind = 'post_draft' and status = 'queued'),
  2, 'the posts it kept are still planned');

-- A replan raises a fresh card; skip closes it and changes nothing.
with r as (insert into public.cmo_runs (user_id, kind, status) values ('e2490000-0000-4000-8000-00000000000a', 'plan_week', 'running') returning id)
insert into t select 'run2', id from r;
select public.cmo_plan_week('e2490000-0000-4000-8000-00000000000a', (select id from t where name = 'run2'), jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date, 'idea', 'A new week')));
insert into t select 'card2', id from public.approvals where user_id = 'e2490000-0000-4000-8000-00000000000a' and kind = 'plan' and status = 'waiting';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2490000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((public.approval_decide((select id from t where name = 'card2'), 'skip', jsonb_build_object(
  'content_hash', (select content_hash from public.approvals where id = (select id from t where name = 'card2')), 'reason', 'Busy week'))).reason,
  'Busy week', 'skip keeps the reason');
reset role;
select is((select count(*)::int from public.content_items where user_id = 'e2490000-0000-4000-8000-00000000000a' and status = 'planned'), 1,
  'skipping the card drops nothing');

select * from finish();
rollback;
