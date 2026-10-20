-- Assistant ở trang project (20260928090000).
--
--   phiên    — một phiên theo project + model, chỉ chủ project mở được;
--              phiên phải có đúng một phạm vi (clip HOẶC project)
--   duyệt    — pause 'approval' → awaiting_approval, giữ khoá, resume được
--              như awaiting_browser, Stop khi đang chờ duyệt hoàn khoản giữ
--   checkpoint — revision của bất kỳ clip nào trong project; clip project khác bị chặn
--   quyền    — người khác không mở phiên, không resume, không đọc được phiên
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

-- The bookkeeping RPCs are service-role only since 20261210201000; these cases test what they do,
-- so this transaction lends them to authenticated (rolled back below).
grant execute on function public.agent_record_usage_for(uuid, uuid, text, integer, integer, integer, integer),
  public.agent_append_for(uuid, uuid, text, jsonb),
  public.agent_record_tool_for(uuid, uuid, text, text, jsonb, text, jsonb, jsonb),
  public.agent_finish_turn_for(uuid, uuid, text, text) to authenticated;

select no_plan();

insert into auth.users (id, email) values
  ('e9700000-0000-4000-8000-00000000000a', 'proj-a@test.local'),
  ('e9700000-0000-4000-8000-00000000000b', 'proj-b@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e9710000-0000-4000-8000-00000000000a', 'e9700000-0000-4000-8000-00000000000a', 'https://a', 600, 'done'),
  ('e9710000-0000-4000-8000-00000000000c', 'e9700000-0000-4000-8000-00000000000a', 'https://c', 600, 'done'),
  ('e9710000-0000-4000-8000-00000000000b', 'e9700000-0000-4000-8000-00000000000b', 'https://b', 600, 'done');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e9720000-0000-4000-8000-00000000000a', 'e9710000-0000-4000-8000-00000000000a', 0, 1, 20, 1, 20),
  ('e9720000-0000-4000-8000-0000000000a2', 'e9710000-0000-4000-8000-00000000000a', 1, 30, 50, 30, 50),
  ('e9720000-0000-4000-8000-00000000000c', 'e9710000-0000-4000-8000-00000000000c', 0, 1, 20, 1, 20);
insert into public.editor_projects(clip_id, document) values
  ('e9720000-0000-4000-8000-0000000000a2', '{"version":1,"stage":{"name":"source-a2"}}'),
  ('e9720000-0000-4000-8000-00000000000c', '{"version":1,"stage":{"name":"source-c"}}');
insert into public.editor_revisions(id, clip_id, number, document, source_hash) values
  ('e9730000-0000-4000-8000-0000000000a2', 'e9720000-0000-4000-8000-0000000000a2', 1, '{"version":1,"stage":{"name":"source-a2"}}', encode(sha256(convert_to('source-a2', 'UTF8')), 'hex')),
  ('e9730000-0000-4000-8000-00000000000c', 'e9720000-0000-4000-8000-00000000000c', 1, '{"version":1,"stage":{"name":"source-c"}}', encode(sha256(convert_to('source-c', 'UTF8')), 'hex'));
insert into public.credit_ledger(user_id, delta, reason) values
  ('e9700000-0000-4000-8000-00000000000a', 20, 'test grant');

-- ================================================================ ràng buộc phạm vi
select throws_ok(
  $$ insert into public.agent_sessions (user_id, model) values ('e9700000-0000-4000-8000-00000000000a', 'fake') $$,
  '23514', null, 'phiên không phạm vi bị chặn'
);
select throws_ok(
  $$ insert into public.agent_sessions (user_id, model, clip_id, job_id) values
       ('e9700000-0000-4000-8000-00000000000a', 'fake', 'e9720000-0000-4000-8000-00000000000a', 'e9710000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'phiên hai phạm vi bị chặn'
);

-- ================================================================ phiên
-- The project-wide assistant's opener went with multi-clip projects (20261220090000); a session
-- scoped to a job still runs on the same turn, approval and checkpoint RPCs.
insert into public.agent_sessions (user_id, model, job_id, scope)
values ('e9700000-0000-4000-8000-00000000000a', 'fake', 'e9710000-0000-4000-8000-00000000000a', 'project');
create temporary table sp as
  select * from public.agent_sessions where job_id = 'e9710000-0000-4000-8000-00000000000a';
grant select on sp to authenticated;
select hasnt_function('public', 'agent_open_project_session', array['uuid', 'text'], 'the project session opener is gone');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e9700000-0000-4000-8000-00000000000a"}';
select isnt(
  (select id from public.agent_open_session('e9720000-0000-4000-8000-00000000000a', 'fake')),
  (select id from sp), 'phiên clip tách khỏi phiên project'
);

-- ================================================================ chờ duyệt
create temporary table t as
  select * from public.agent_begin_turn((select id from sp), 'Yellow captions on all clips', '[{"text":"x"}]');
grant select on t to authenticated;
select lives_ok(
  $$ select public.agent_record_tool_for(auth.uid(), (select id from t), 'ap_0', 'apply_to_clips',
       '{"clip_ids":[],"ops":[]}', 'pending', '{"approval":{"clips":[],"changes":[]}}') $$,
  'tool duyệt lưu pending kèm thẻ'
);
select throws_ok(
  $$ select public.agent_pause_turn((select id from t), 'nope') $$,
  '22023', 'Invalid pause reason.', 'lý do tạm dừng lạ bị chặn'
);
select lives_ok($$ select public.agent_pause_turn((select id from t), 'approval') $$, 'tạm dừng chờ duyệt');
select is((select status from public.agent_turns where id = (select id from t)), 'awaiting_approval', 'lượt chờ duyệt');
select throws_ok(
  $$ select public.agent_begin_turn((select id from sp), 'again', '[{"text":"x"}]') $$,
  'P0001', 'The assistant is already working on this clip.', 'đang chờ duyệt vẫn giữ khoá'
);
select throws_ok(
  $$ select public.agent_mark_undone((select id from t)) $$,
  'P0001', 'Wait for the assistant to finish before undoing.', 'không undo lượt đang chờ duyệt'
);

-- người khác không resume, không thấy phiên
set local request.jwt.claims = '{"sub":"e9700000-0000-4000-8000-00000000000b"}';
select throws_ok(
  $$ select public.agent_resume_turn((select id from sp)) $$,
  'P0002', 'Assistant session not found.', 'người khác không resume được'
);
select is((select count(*) from public.agent_sessions where id = (select id from sp)), 0::bigint, 'RLS giấu phiên người khác');
set local request.jwt.claims = '{"sub":"e9700000-0000-4000-8000-00000000000a"}';

select is((select status from public.agent_resume_turn((select id from sp))), 'running', 'resume từ chờ duyệt');

-- ================================================================ checkpoint
select throws_ok(
  $$ select public.agent_set_checkpoint((select id from t), 'e9730000-0000-4000-8000-00000000000c') $$,
  'P0002', 'That version is no longer available.', 'revision của clip project khác bị chặn'
);
select lives_ok(
  $$ select public.agent_set_checkpoint((select id from t), 'e9730000-0000-4000-8000-0000000000a2') $$,
  'revision của clip bất kỳ trong project'
);
select is(
  (select checkpoint_id from public.agent_turns where id = (select id from t)),
  'e9730000-0000-4000-8000-0000000000a2'::uuid, 'lượt nhớ checkpoint'
);

-- ================================================================ Stop khi chờ duyệt
select lives_ok(
  $$ select public.agent_complete_tool((select id from t), 'ap_0', 'done', '{"summary":"Changed 1 of 2 clips"}') $$,
  'hoàn tất tool duyệt'
);
select lives_ok($$ select public.agent_record_tool_for(auth.uid(), (select id from t), 'ap_1', 'apply_to_clips', '{}', 'pending', '{"approval":{}}') $$, 'thẻ thứ hai');
select lives_ok($$ select public.agent_pause_turn((select id from t), 'approval') $$, 'chờ duyệt lần hai');
select lives_ok($$ select public.agent_stop((select id from sp)) $$, 'Stop khi chờ duyệt');
select is((select status from public.agent_turns where id = (select id from t)), 'stopped', 'lượt dừng');
select is(
  (select status from public.agent_tool_calls where turn_id = (select id from t) and tool_use_id = 'ap_1'),
  'failed', 'thẻ đang chờ thành failed'
);
select is(
  (select coalesce(sum(delta), 0) from public.credit_ledger where user_id = 'e9700000-0000-4000-8000-00000000000a'),
  20::bigint, 'khoản giữ được hoàn'
);

select * from finish();
rollback;
