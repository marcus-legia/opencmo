-- C2 (20270112020000): the founder's own finished edit goes out. Marked finished and rendered at that hash, a
-- `post_video` order follows the render through the look check; since 20270122010000 (one card per platform) the
-- video gets no card of its own: Writer is asked for its captions, the video is the order's `video` deliverable and
-- each platform with a caption gets its schedule card. A failed render fails the order; the founder's other exports
-- change nothing; another founder cannot start it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(23);

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

-- The render of the finished hash: the look check, then the platforms' cards.
update public.tasks set status = 'done' where id = (select id from t where name = 'render');
select is((select count(*)::int from public.look_checks where order_id = (select id from t where name = 'order')), 1, 'the render is looked at');
update public.tasks set status = 'done', output = '{"pass":true,"round":0,"note":"","files":[]}'
where id = (select task_id from public.look_checks where order_id = (select id from t where name = 'order'));
select is((select count(*)::int from public.approvals where ref_kind = 'editor_project' and ref_id = (select id from t where name = 'clip')), 0,
  'the video gets no card of its own');
select is((select status from public.work_orders where id = (select id from t where name = 'order')), 'done', 'the order is done');
select ok(exists (select 1 from public.work_orders where kind = 'write_caption' and brief->>'ref_id' = (select id from t where name = 'clip')::text),
  'Writer is asked for its captions');
select is((select status from public.deliverables where order_id = (select id from t where name = 'order') and kind = 'video'), 'decided',
  'the video is its deliverable');
select is((select status from public.content_items where clip_id = (select id from t where name = 'clip') and platform = 'youtube'), 'in_review',
  'its caption waits on its platform''s card');
select is((select s.platform || ' ' || s.status || ' ' || a.status from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
  join public.approvals a on a.id = s.approval_id
  where d.order_id = (select id from t where name = 'order') and d.kind = 'video'), 'youtube proposed waiting',
  'Schedule asks on a card where it has a caption');

-- Marked finished again at the same hash: nothing new. Edited and marked again: a new order, and the video's
-- deliverable moves to that order (review fix: it used to fail on the existing deliverable).
set local role authenticated;
select ok(not public.post_video_wanted((select id from t where name = 'clip')), 'already done at this hash: nothing to start');
reset role;
update public.editor_projects set document = document || '{"cut": 1}' where clip_id = (select id from t where name = 'clip');
set local role authenticated;
select public.mark_finished((select id from t where name = 'clip'), pg_temp.hash('clip'));
reset role;
insert into t select 'render_b', pg_temp.render('clip', pg_temp.hash('clip'));
update public.tasks set status = 'done' where id = (select id from t where name = 'render_b');
set local role authenticated;
insert into t select 'order_b', public.post_video_start((select id from t where name = 'clip'), (select id from t where name = 'render_b'));
reset role;
update public.tasks set status = 'done', output = '{"pass":true,"round":0,"note":"","files":[]}'
where id = (select task_id from public.look_checks where order_id = (select id from t where name = 'order_b'));
select is((select o.status || ' ' || (d.order_id = o.id) from public.work_orders o join public.deliverables d on d.ref_kind = 'clip' and d.ref_id = (select id from t where name = 'clip')
  where o.id = (select id from t where name = 'order_b')), 'done true', 'an edited video is ready again, its deliverable under the new order');

-- A failed render fails its order; a render done already is settled at once.
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
select is((select status from public.work_orders where id = (select id from t where name = 'order3')), 'done',
  'a render done already is settled at once');

-- An edit after marking it finished cancels its posting; the render of the old version then raises nothing.
update public.editor_projects set document = document || '{"cut": 3}' where clip_id = (select id from t where name = 'clip2');
set local role authenticated;
select public.mark_finished((select id from t where name = 'clip2'), pg_temp.hash('clip2'));
reset role;
insert into t select 'render4', pg_temp.render('clip2', pg_temp.hash('clip2'));
set local role authenticated;
insert into t select 'order4', public.post_video_start((select id from t where name = 'clip2'), (select id from t where name = 'render4'));
reset role;
update public.editor_projects set document = document || '{"cut": 4}' where clip_id = (select id from t where name = 'clip2');
select is((select status from public.work_orders where id = (select id from t where name = 'order4')), 'cancelled', 'an edit after marking it finished cancels its posting');
update public.tasks set status = 'done' where id = (select id from t where name = 'render4');
select is((select count(*)::int from public.look_checks where order_id = (select id from t where name = 'order4')), 0, 'and the old render starts no check');

select * from finish();
rollback;
