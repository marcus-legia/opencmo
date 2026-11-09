-- C2 (20270112020000): the founder's own finished edit goes out. Marked finished and rendered at that hash, a
-- `post_video` order follows the render through the look check to the finished-video card; approving it makes the
-- `video` deliverable and Schedule proposes its time. A failed render fails the order; sending the card back cancels
-- it; the founder's other exports change nothing; another founder cannot start it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(20);

select ok(has_function_privilege('authenticated', 'public.post_video_start(uuid,uuid)', 'execute'), 'founders start it');
select ok(not has_function_privilege('authenticated', 'public.post_video_render_settled(public.work_orders,public.tasks)', 'execute'),
  'only the render rule settles it');
select is(public.work_order_department('post_video'), 'studio', 'a Studio order');
select ok(has_function_privilege('authenticated', 'public.post_video_wanted(uuid)', 'execute'), 'and ask first whether it is wanted');

insert into auth.users (id, email) values
  ('e2740000-0000-4000-8000-00000000000a', 'pv-a@test.local'),
  ('e2740000-0000-4000-8000-00000000000b', 'pv-b@test.local');
update public.profiles set timezone = 'UTC' where id = 'e2740000-0000-4000-8000-00000000000a';
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2740000-0000-4000-8000-00000000000a","role":"authenticated"}';
insert into t select 'clip', public.create_blank_edit('My demo', '16:9');
insert into t select 'clip2', public.create_blank_edit('Another demo', '9:16');
reset role;
insert into public.editor_projects (clip_id, document) select id, jsonb_build_object('version', 1, 'name', name) from t;
create function pg_temp.hash(p text) returns text language sql as $$
  select public.editor_document_hash(document) from public.editor_projects where clip_id = (select id from t where name = p) $$;
create function pg_temp.render(p text, p_hash text) returns uuid language sql as $$
  insert into public.tasks (user_id, kind, clip_id, settings_hash, status, request_id, output_path)
  values ('e2740000-0000-4000-8000-00000000000a', 'render_document', (select id from t where name = p), p_hash, 'running', gen_random_uuid(),
    'e2740000-0000-4000-8000-00000000000a/' || (select id from t where name = p) || '/x.mp4')
  returning id $$;
-- A caption Writer wrote for the video, waiting on its card.
insert into public.content_items (user_id, department, platform, day, idea, status, body, clip_id) values
  ('e2740000-0000-4000-8000-00000000000a', 'video', 'youtube', current_date, 'My demo', 'in_review',
   '{"text":"How I cut my demo.","title":"Cut a demo by words"}', (select id from t where name = 'clip'));

set local role authenticated;
select ok(not public.post_video_wanted((select id from t where name = 'clip')), 'an edit not finished is not');
select public.mark_finished((select id from t where name = 'clip'), pg_temp.hash('clip'));
select ok(public.post_video_wanted((select id from t where name = 'clip')), 'a finished edit of their own is wanted');
reset role;
insert into t select 'render', pg_temp.render('clip', pg_temp.hash('clip'));
insert into t select 'other', pg_temp.render('clip', repeat('e', 64));

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2740000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok(format($$ select public.post_video_start(%L, %L) $$, (select id from t where name = 'clip'), (select id from t where name = 'render')),
  'P0002', null, 'another founder cannot start it');
set local request.jwt.claims = '{"sub":"e2740000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.post_video_start(%L, %L) $$, (select id from t where name = 'clip'), (select id from t where name = 'other')),
  'P0001', 'That render is not of this edit.', 'a render of another version is refused');
insert into t select 'order', public.post_video_start((select id from t where name = 'clip'), (select id from t where name = 'render'));
reset role;
select is((select kind || ' ' || status || ' ' || (brief->>'finished_hash') from public.work_orders where id = (select id from t where name = 'order')),
  'post_video running ' || pg_temp.hash('clip'), 'a running post_video order follows the finished hash');

-- The founder's export of another version settles nothing.
update public.tasks set status = 'done' where id = (select id from t where name = 'other');
select is((select count(*)::int from public.look_checks where order_id = (select id from t where name = 'order')), 0, 'another export starts no check');

-- The render of the finished hash: the look check, then card 3.
update public.tasks set status = 'done' where id = (select id from t where name = 'render');
select is((select count(*)::int from public.look_checks where order_id = (select id from t where name = 'order')), 1, 'the render is looked at');
update public.tasks set status = 'done', output = '{"pass":true,"round":0,"note":"","files":[]}'
where id = (select task_id from public.look_checks where order_id = (select id from t where name = 'order'));
insert into t select 'card', id from public.approvals where ref_kind = 'editor_project' and ref_id = (select id from t where name = 'clip') and status = 'waiting';
select is((select kind from public.approvals where id = (select id from t where name = 'card')), 'finished_video', 'the finished-video card asks the founder');
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'waiting_founder', 'the order waits on it');
select ok(exists (select 1 from public.work_orders where kind = 'write_caption' and brief->>'ref_id' = (select id from t where name = 'clip')::text),
  'Writer is asked for its captions');

-- Approved: the video is the order's deliverable, its caption is approved, Schedule proposes a time.
set local role authenticated;
select public.approval_decide((select id from t where name = 'card'), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = (select id from t where name = 'card'))));
reset role;
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'done', 'the order is done');
select is((select status from public.deliverables where order_id = (select id from t where name = 'order') and kind = 'video'), 'decided',
  'with the video as its deliverable');
select is((select status from public.content_items where clip_id = (select id from t where name = 'clip') and platform = 'youtube'), 'approved',
  'the caption it showed is approved');
select is((select platform from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
  where d.order_id = (select id from t where name = 'order') and d.kind = 'video'), 'youtube', 'Schedule proposes a time where it has a caption');

-- A failed render fails its order; sending a card back cancels the order (the founder marks it finished again).
set local role authenticated;
select public.mark_finished((select id from t where name = 'clip2'), pg_temp.hash('clip2'));
reset role;
insert into t select 'render2', pg_temp.render('clip2', pg_temp.hash('clip2'));
set local role authenticated;
insert into t select 'order2', public.post_video_start((select id from t where name = 'clip2'), (select id from t where name = 'render2'));
reset role;
update public.tasks set status = 'failed', error = 'The worker stopped.' where id = (select id from t where name = 'render2');
select is((select status || ' ' || (error->>'code') from public.work_orders where id = (select id from t where name = 'order2')), 'failed render_failed',
  'a failed render fails the order');
insert into t select 'render3', pg_temp.render('clip2', pg_temp.hash('clip2'));
update public.tasks set status = 'done' where id = (select id from t where name = 'render3');
set local role authenticated;
insert into t select 'order3', public.post_video_start((select id from t where name = 'clip2'), (select id from t where name = 'render3'));
reset role;
update public.tasks set status = 'done', output = '{"pass":true,"round":0,"note":"","files":[]}'
where id = (select task_id from public.look_checks where order_id = (select id from t where name = 'order3'));
set local role authenticated;
select public.approval_decide(a.id, 'send_back', jsonb_build_object('content_hash', a.content_hash, 'reason', 'Cut the intro'))
from public.approvals a where a.ref_kind = 'editor_project' and a.ref_id = (select id from t where name = 'clip2') and a.status = 'waiting';
reset role;
select is((select status from public.work_orders where id = (select id from t where name = 'order3')), 'cancelled',
  'a render done already is settled at once, and sending the card back cancels the order');

select * from finish();
rollback;
