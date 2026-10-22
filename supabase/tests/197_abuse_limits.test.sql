-- Security review 2026-10-22 (20261224090000): limits that a direct PostgREST call cannot skip.
--   write budget — transcripts and marketing documents per user per hour, by rows and by bytes
--   retry_job    — the in-progress cap, the retry rate limit, purged projects
--   small rows   — MCP confirm codes and new CMO conversations per hour
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select no_plan();

insert into auth.users (id, email) values
  ('e1970000-0000-4000-8000-00000000000a', 'abuse-rows@test.local'),
  ('e1970000-0000-4000-8000-00000000000b', 'abuse-bytes@test.local'),
  ('e1970000-0000-4000-8000-00000000000c', 'abuse-retry@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1971000-0000-4000-8000-00000000000a', 'e1970000-0000-4000-8000-00000000000a', 'https://a', 600, 'done'),
  ('e1971000-0000-4000-8000-00000000000b', 'e1970000-0000-4000-8000-00000000000b', 'https://b', 600, 'done'),
  ('e1971000-0000-4000-8000-0000000000c1', 'e1970000-0000-4000-8000-00000000000c', 'https://c', 600, 'failed'),
  ('e1971000-0000-4000-8000-0000000000c2', 'e1970000-0000-4000-8000-00000000000c', 'https://c', 600, 'queued'),
  ('e1971000-0000-4000-8000-0000000000c3', 'e1970000-0000-4000-8000-00000000000c', 'https://c', 600, 'queued'),
  ('e1971000-0000-4000-8000-0000000000c4', 'e1970000-0000-4000-8000-00000000000c', 'https://c', 600, 'running');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e1972000-0000-4000-8000-00000000000a', 'e1971000-0000-4000-8000-00000000000a', 0, 0, 20, 0, 20),
  ('e1972000-0000-4000-8000-00000000000b', 'e1971000-0000-4000-8000-00000000000b', 0, 0, 20, 0, 20);
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1970000-0000-4000-8000-00000000000c', 100, 'test grant');

-- Seeded as the server (no signed-in user): 128 MB less 0.2 MB of transcripts this hour for user b, uncounted.
insert into public.editor_transcripts (clip_id, hash, body)
select 'e1972000-0000-4000-8000-00000000000b', encode(sha256(convert_to(g::text, 'UTF8')), 'hex'), repeat('a', 500000)
from generate_series(1, 268) g;
select is((select count(*)::int from public.editor_transcripts where clip_id = 'e1972000-0000-4000-8000-00000000000b'), 268,
  'the server''s writes are not counted');

set local role authenticated;

-- ================================================================ write budget: rows
set local request.jwt.claims = '{"sub":"e1970000-0000-4000-8000-00000000000a"}';
select is(
  (select count(*)::int from generate_series(1, 1200) g,
     lateral (select public.put_editor_transcript('e1972000-0000-4000-8000-00000000000a', '[{"text":"line ' || g || '","words":[]}]')) x),
  1200, '1200 transcripts in an hour pass');
select throws_ok(
  $$ select public.put_editor_transcript('e1972000-0000-4000-8000-00000000000a', '[{"text":"one more","words":[]}]') $$,
  'P0001', 'You have saved a lot of changes in the last hour. Wait a few minutes and try again.',
  'the 1201st transcript is refused');
select is(
  (select count(*)::int from generate_series(1, 300) g,
     lateral (select public.save_marketing_document('product', jsonb_build_object('n', g))) x),
  300, '300 marketing document versions in an hour pass');
select throws_ok($$ select public.save_marketing_document('product', '{"n": 301}') $$,
  'P0001', 'You have saved a lot of changes in the last hour. Wait a few minutes and try again.',
  'the 301st marketing document version is refused');

-- ================================================================ write budget: bytes
set local request.jwt.claims = '{"sub":"e1970000-0000-4000-8000-00000000000b"}';
-- The server's 268 rows above left user b's budget untouched: the next big write fits.
select lives_ok(
  format($$ select public.put_editor_transcript('e1972000-0000-4000-8000-00000000000b', '[{"text":"%s","words":[]}]') $$, repeat('c', 500000)),
  'the server''s rows on the same clip do not use the user''s budget');
reset role;
-- Now counted: the same amount written by user b while signed in (the ledger keeps the user's own writes).
delete from public.write_budget_ledger where user_id = 'e1970000-0000-4000-8000-00000000000b';
insert into public.write_budget_ledger (user_id, table_name, bytes)
select 'e1970000-0000-4000-8000-00000000000b', 'editor_transcripts', 500000 from generate_series(1, 268);
set local role authenticated;
select lives_ok(
  $$ select public.put_editor_transcript('e1972000-0000-4000-8000-00000000000b', '[{"text":"small","words":[]}]') $$,
  'a small transcript fits under 128 MB');
select throws_ok(
  format($$ select public.put_editor_transcript('e1972000-0000-4000-8000-00000000000b', '[{"text":"%s","words":[]}]') $$, repeat('b', 500000)),
  'P0001', 'You have saved a lot of changes in the last hour. Wait a few minutes and try again.',
  'a transcript past 128 MB in the hour is refused');

-- ================================================================ retry_job
set local request.jwt.claims = '{"sub":"e1970000-0000-4000-8000-00000000000c"}';
select throws_ok($$ select public.retry_job('e1971000-0000-4000-8000-0000000000c1') $$,
  'P0001', 'You already have 3 projects in progress. Please wait for one to finish.',
  'retry respects the 3-in-progress cap');
reset role;
update public.jobs set status = 'done' where id = 'e1971000-0000-4000-8000-0000000000c4';
insert into public.rate_limits (user_id, bucket, window_start, count)
values ('e1970000-0000-4000-8000-00000000000c', 'retry', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 20);
set local role authenticated;
select throws_ok($$ select public.retry_job('e1971000-0000-4000-8000-0000000000c1') $$,
  'P0001', 'Too many retries. Please wait a while and try again.', 'retry respects the hourly retry limit');
reset role;
delete from public.rate_limits where user_id = 'e1970000-0000-4000-8000-00000000000c';
update public.jobs set purging_at = now() where id = 'e1971000-0000-4000-8000-0000000000c1';
set local role authenticated;
select throws_ok($$ select public.retry_job('e1971000-0000-4000-8000-0000000000c1') $$,
  'P0002', 'Project not found.', 'a project being purged cannot be retried');
reset role;
update public.jobs set purging_at = null where id = 'e1971000-0000-4000-8000-0000000000c1';
set local role authenticated;
select is((public.retry_job('e1971000-0000-4000-8000-0000000000c1')).status, 'queued'::public.job_status,
  'under the caps, retry still works');

-- ================================================================ small rows
select is((select count(*)::int from generate_series(1, 600) g where public.mcp_confirm_use(gen_random_uuid())), 600,
  '600 confirm codes in an hour pass');
select throws_ok($$ select public.mcp_confirm_use(gen_random_uuid()) $$,
  'P0001', 'Too many confirm codes in the last hour. Try again later.', 'the 601st confirm code is refused');
select is((select count(*)::int from generate_series(1, 30) g, lateral (select public.agent_open_cmo_session('fake', g > 0)) x), 30,
  '30 new CMO conversations in an hour pass');
select throws_ok($$ select public.agent_open_cmo_session('fake', true) $$,
  'P0001', 'Too many new conversations in the last hour. Try again later.', 'the 31st new conversation is refused');
select is((public.agent_open_cmo_session('fake', false)).scope, 'cmo', 'reopening the latest conversation is not capped');

-- ================================================================ rate limits
select is(public.rate_limit_hit('generations', 120, 3600), true, 'the generations route has its bucket');
select is(public.rate_limit_hit('mcp_preview', 30, 3600), true, 'MCP previews: the old cap still works');
select is(public.rate_limit_hit('mcp_preview', 60, 3600), true, 'MCP previews: the cap of motion quality A3 works');
select throws_ok($$ select public.rate_limit_hit('generations', 1000, 3600) $$, '22023', 'Invalid rate limit.', 'the caller cannot raise its own cap');

-- ================================================================ privileges
reset role;
select ok(not has_function_privilege('authenticated', 'public.enforce_write_budget()', 'execute'), 'users cannot call the budget trigger');
select ok(not has_function_privilege('authenticated', 'public.refund_caption_translation(uuid)', 'execute'), 'users cannot refund translations');
select ok(has_function_privilege('service_role', 'public.refund_caption_translation(uuid)', 'execute'), 'the server can refund translations');

select * from finish();
rollback;
