-- Review follow-ups (20270105010000). Q8: the link cases of packages/contracts/link-cases.json (check-post.check
-- verifies every case is here).
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(18);

select throws_ok($$ select public.caption_check('tiktok_caption', 'https://acme.io', null) $$, '22023', 'Captions carry no links.', 'a URL');
select throws_ok($$ select public.caption_check('tiktok_caption', 'see www.acme.io', null) $$, '22023', 'Captions carry no links.', 'a www address');
select throws_ok($$ select public.caption_check('tiktok_caption', 'opencmo.io/pricing', null) $$, '22023', 'Captions carry no links.', 'a domain with a path');
select throws_ok($$ select public.caption_check('tiktok_caption', 'Read acme.com/blog now', null) $$, '22023', 'Captions carry no links.', 'inside a sentence');
select throws_ok($$ select public.caption_check('tiktok_caption', 'go to example.fr/start', null) $$, '22023', 'Captions carry no links.', 'any TLD');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Built with Next.js/React', null) $$, 'a framework name is not a link');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Next.js and Node.js', null) $$, 'nor two of them');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Ship the app.tsx/hooks folder', null) $$, 'nor a code path');
select lives_ok($$ select public.caption_check('tiktok_caption', 'a 50/50 split', null) $$, 'nor a fraction');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Version 2.0/3.0', null) $$, 'nor version numbers');

-- R2: the dead allowlist entries and consume_daily_task_quota are gone; the buckets in use still work.
select hasnt_function('public', 'consume_daily_task_quota', array['text'], 'consume_daily_task_quota is gone');
insert into auth.users (id, email) values ('e2440000-0000-4000-8000-00000000000a', 'fu-r2@test.local');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2440000-0000-4000-8000-00000000000a"}';
select throws_ok($$ select public.rate_limit_hit('zip', 20, 3600) $$, '22023', 'Invalid rate limit.', 'the zip bucket is gone');
select throws_ok($$ select public.rate_limit_hit('mcp_preview', 30, 3600) $$, '22023', 'Invalid rate limit.', 'the 30-an-hour MCP preview is gone');
select ok(public.rate_limit_hit('mcp_preview', 60, 3600) and public.rate_limit_hit('feedback-turn', 60, 3600), 'the buckets in use still work');
reset role;

-- L6: a task queued over 10 minutes is claimed before a fresher one of a higher-priority kind.
insert into public.jobs (id, user_id, source_url, status) values
  ('e2441000-0000-4000-8000-00000000000a', 'e2440000-0000-4000-8000-00000000000a', 'https://a', 'done');
insert into public.tasks (id, user_id, kind, job_id, request_id, created_at) values
  ('e2442000-0000-4000-8000-000000000001', 'e2440000-0000-4000-8000-00000000000a', 'render_document', 'e2441000-0000-4000-8000-00000000000a', gen_random_uuid(), now() - interval '1 minute'),
  ('e2442000-0000-4000-8000-000000000002', 'e2440000-0000-4000-8000-00000000000a', 'look_check', 'e2441000-0000-4000-8000-00000000000a', gen_random_uuid(), now() - interval '11 minutes');
set local role service_role;
select is((select id from public.claim_next_task(array['render_document', 'look_check'])), 'e2442000-0000-4000-8000-000000000002'::uuid,
  'the task waiting 11 minutes goes first');
select is((select id from public.claim_next_task(array['render_document', 'look_check'])), 'e2442000-0000-4000-8000-000000000001'::uuid,
  'then the rest in order');
reset role;

-- C3: a failed export gives the day's export back (rate_limits counted on the day it was asked for).
insert into public.rate_limits (user_id, bucket, window_start, count)
values ('e2440000-0000-4000-8000-00000000000a', 'export', to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), 2);
insert into public.tasks (id, user_id, kind, job_id, request_id, status, attempt_id) values
  ('e2442000-0000-4000-8000-000000000003', 'e2440000-0000-4000-8000-00000000000a', 'render_document', 'e2441000-0000-4000-8000-00000000000a',
   gen_random_uuid(), 'running', 'e2443000-0000-4000-8000-000000000001');
set local role service_role;
select ok(public.fail_task('e2442000-0000-4000-8000-000000000003', 'e2443000-0000-4000-8000-000000000001', 'boom'), 'the export fails');
reset role;
select is((select count from public.rate_limits where user_id = 'e2440000-0000-4000-8000-00000000000a' and bucket = 'export'), 1,
  'and the day''s export is given back');

select * from finish();
rollback;
