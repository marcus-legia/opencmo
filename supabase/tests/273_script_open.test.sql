-- C1 (20270112010000): a script's calendar item follows its card; "Open in editor" is refused before approval and for
-- another founder, then one blank edit per script. A replan keeps a written script and its item; one still being written
-- when the plan drops its item raises no card.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(17);

select ok(has_function_privilege('authenticated', 'public.cmo_script_open(uuid)', 'execute'), 'founders call it');
select ok(not has_function_privilege('anon', 'public.cmo_script_open(uuid)', 'execute'), 'anon does not');

insert into auth.users (id, email) values
  ('e2730000-0000-4000-8000-00000000000a', 'so-a@test.local'),
  ('e2730000-0000-4000-8000-00000000000b', 'so-b@test.local');
update public.profiles set credit_balance = 50 where id = 'e2730000-0000-4000-8000-00000000000a';
insert into public.cmo_insights (user_id, kind, body) values ('e2730000-0000-4000-8000-00000000000a', 'niche_video', '{}');
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;

insert into public.cmo_runs (id, user_id, kind, status) values
  ('e2731000-0000-4000-8000-00000000000a', 'e2730000-0000-4000-8000-00000000000a', 'plan_week', 'running');
select public.cmo_plan_week('e2730000-0000-4000-8000-00000000000a', 'e2731000-0000-4000-8000-00000000000a',
  jsonb_build_array(jsonb_build_object('day', current_date, 'department', 'video', 'platform', 'Shorts', 'idea', 'A demo', 'reason', 'r')));
insert into t select 'brief', id from public.work_orders where kind = 'write_video_brief' and user_id = 'e2730000-0000-4000-8000-00000000000a';
update public.cmo_runs set status = 'done', finished_at = now(), output = jsonb_build_object('reason', 'r',
  'brief', jsonb_build_object('objective', 'Show the demo', 'hooks', jsonb_build_array('a', 'b', 'c'), 'seconds', 30, 'aspect', '16:9',
    'storyboard', jsonb_build_array(jsonb_build_object('say', 'a', 'show', 'You', 'shot', 'talking_head', 'seconds', 10),
      jsonb_build_object('say', 'b', 'show', 'Screen', 'shot', 'screen', 'seconds', 10),
      jsonb_build_object('say', 'c', 'show', 'You', 'shot', 'talking_head', 'seconds', 10))))
where input->>'order_id' = (select id from t where name = 'brief')::text;
insert into t select 'card', id from public.approvals where ref_kind = 'work_order' and ref_id = (select id from t where name = 'brief');
select is((select c.status from public.content_items c join public.work_orders o on o.item_id = c.id where o.id = (select id from t where name = 'brief')),
  'in_review', 'the calendar item waits with its card');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2730000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_script_open(%L) $$, (select id from t where name = 'brief')),
  'P0001', 'Approve the script first.', 'not before the founder approves it');
select public.approval_decide((select id from t where name = 'card'), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = (select id from t where name = 'card'))));
insert into t select 'clip', public.cmo_script_open((select id from t where name = 'brief'));
select is(public.cmo_script_open((select id from t where name = 'brief')), (select id from t where name = 'clip'), 'a second click opens the same edit');
reset role;
select is((select c.kind || ' ' || j.aspect || ' ' || c.hook from public.clips c join public.jobs j on j.id = c.job_id
  where c.id = (select id from t where name = 'clip')), 'blank 16:9 Show the demo', 'a blank edit in the script''s frame, named after it');
select is((select brief->>'clip_id' from public.work_orders where id = (select id from t where name = 'brief')),
  (select id from t where name = 'clip')::text, 'kept on the order');
select is((select status from public.approvals where id = (select id from t where name = 'card')), 'approved', 'the card stays approved');
select is((select c.status from public.content_items c join public.work_orders o on o.item_id = c.id where o.id = (select id from t where name = 'brief')),
  'approved', 'approved, the founder records it');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2730000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_script_open(%L) $$, (select id from t where name = 'brief')),
  'P0002', 'Script not found.', 'another founder''s script is not found');
reset role;

-- A replan keeps a written script and its calendar item (it is past `planned`); a new video item is its own script.
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e2731000-0000-4000-8000-00000000000b', 'e2730000-0000-4000-8000-00000000000a', 'plan_week', 'running');
select public.cmo_plan_week('e2730000-0000-4000-8000-00000000000a', 'e2731000-0000-4000-8000-00000000000b',
  jsonb_build_array(jsonb_build_object('day', current_date + 1, 'department', 'video', 'platform', 'Shorts', 'idea', 'Another demo', 'reason', 'r')));
select is((select c.idea || ' / ' || o.status from public.content_items c join public.work_orders o on o.item_id = c.id
  where o.id = (select id from t where name = 'brief')), 'A demo / done', 'a replan keeps the written script and its item');
select is((select count(*)::int from public.work_orders where kind = 'write_video_brief' and user_id = 'e2730000-0000-4000-8000-00000000000a'), 2,
  'the new video item is its own script');

-- A script still being written when the plan drops its item raises no card when it ends.
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e2731000-0000-4000-8000-00000000000c', 'e2730000-0000-4000-8000-00000000000b', 'plan_week', 'running'),
  ('e2731000-0000-4000-8000-00000000000d', 'e2730000-0000-4000-8000-00000000000b', 'plan_week', 'running');
update public.profiles set credit_balance = 50 where id = 'e2730000-0000-4000-8000-00000000000b';
insert into public.cmo_insights (user_id, kind, body) values ('e2730000-0000-4000-8000-00000000000b', 'niche_video', '{}');
select public.cmo_plan_week('e2730000-0000-4000-8000-00000000000b', 'e2731000-0000-4000-8000-00000000000c',
  jsonb_build_array(jsonb_build_object('day', current_date, 'department', 'video', 'platform', 'Shorts', 'idea', 'B''s demo', 'reason', 'r')));
insert into t select 'brief_b', id from public.work_orders where kind = 'write_video_brief' and user_id = 'e2730000-0000-4000-8000-00000000000b';
update public.cmo_runs set status = 'running', started_at = now() where input->>'order_id' = (select id from t where name = 'brief_b')::text;
select public.cmo_plan_week('e2730000-0000-4000-8000-00000000000b', 'e2731000-0000-4000-8000-00000000000d',
  jsonb_build_array(jsonb_build_object('day', current_date, 'department', 'post', 'platform', 'X', 'idea', 'A post', 'reason', 'r')));
select is((select item_id from public.work_orders where id = (select id from t where name = 'brief_b')), null, 'the plan dropped its item');
update public.cmo_runs set status = 'done', finished_at = now(), output = (select output from public.cmo_runs where input->>'order_id' = (select id from t where name = 'brief')::text)
where input->>'order_id' = (select id from t where name = 'brief_b')::text;
select is((select status from public.work_orders where id = (select id from t where name = 'brief_b')), 'done', 'the script ends');
select is((select count(*)::int from public.approvals where ref_kind = 'work_order' and ref_id = (select id from t where name = 'brief_b')), 0,
  'with no card for a video the founder removed');

-- A written script whose calendar item the founder deleted: the next plan withdraws its waiting card.
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e2731000-0000-4000-8000-00000000000e', 'e2730000-0000-4000-8000-00000000000b', 'plan_week', 'running'),
  ('e2731000-0000-4000-8000-00000000000f', 'e2730000-0000-4000-8000-00000000000b', 'plan_week', 'running');
select public.cmo_plan_week('e2730000-0000-4000-8000-00000000000b', 'e2731000-0000-4000-8000-00000000000e',
  jsonb_build_array(jsonb_build_object('day', current_date + 2, 'department', 'video', 'platform', 'Reels', 'idea', 'B''s second demo', 'reason', 'r')));
insert into t select 'brief_c', o.id from public.work_orders o join public.content_items c on c.id = o.item_id where c.idea = 'B''s second demo';
update public.cmo_runs set status = 'done', finished_at = now(), output = (select output from public.cmo_runs where input->>'order_id' = (select id from t where name = 'brief')::text)
where input->>'order_id' = (select id from t where name = 'brief_c')::text;
select is((select status from public.approvals where ref_kind = 'work_order' and ref_id = (select id from t where name = 'brief_c')), 'waiting', 'its card waits');
delete from public.content_items where id = (select item_id from public.work_orders where id = (select id from t where name = 'brief_c'));
select public.cmo_plan_week('e2730000-0000-4000-8000-00000000000b', 'e2731000-0000-4000-8000-00000000000f',
  jsonb_build_array(jsonb_build_object('day', current_date, 'department', 'post', 'platform', 'X', 'idea', 'Another post', 'reason', 'r')));
select is((select status from public.approvals where ref_kind = 'work_order' and ref_id = (select id from t where name = 'brief_c')), 'cancelled',
  'the next plan withdraws it');

select * from finish();
rollback;
