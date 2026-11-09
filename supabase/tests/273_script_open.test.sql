-- C1 (20270112010000): "Open in editor" on a script. Refused before the founder approves it and for another founder;
-- after approval, one blank edit per script, the same on every click.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(8);

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

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2730000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_script_open(%L) $$, (select id from t where name = 'brief')),
  'P0002', 'Script not found.', 'another founder''s script is not found');
reset role;

select * from finish();
rollback;
