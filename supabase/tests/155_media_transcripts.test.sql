-- 20261125090000: one transcript per stored file — free automatic run after the probe (with a
-- daily cap), reuse by every clip, no double charge on the paid captions path, owner-only reads.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(30);

insert into auth.users (id, email) values
  ('e1550000-0000-4000-8000-00000000000a', 'mt-a@test.local'),
  ('e1550000-0000-4000-8000-00000000000b', 'mt-b@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1551000-0000-4000-8000-00000000000a', 'e1550000-0000-4000-8000-00000000000a', 'storage://e1550000-0000-4000-8000-00000000000a/talk.mp4', 600, 'done'),
  ('e1551100-0000-4000-8000-00000000000a', 'e1550000-0000-4000-8000-00000000000a', 'storage://e1550000-0000-4000-8000-00000000000a/other.mp4', 600, 'done');
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, source_start, source_end) values
  ('e1552000-0000-4000-8000-00000000000a', 'e1551000-0000-4000-8000-00000000000a', 0, 'Hook', 0, 30, 0, 30);
-- talk: speech, 120 s · silent: no audio · long: 40 min · old: uploaded before this migration.
insert into public.media_assets (id, user_id, job_id, storage_path, name, status) values
  ('e1553000-0000-4000-8000-00000000000a', 'e1550000-0000-4000-8000-00000000000a', 'e1551000-0000-4000-8000-00000000000a', 'media/a/talk.mp4', 'talk.mp4', 'pending'),
  ('e1553100-0000-4000-8000-00000000000a', 'e1550000-0000-4000-8000-00000000000a', 'e1551000-0000-4000-8000-00000000000a', 'media/a/silent.mp4', 'silent.mp4', 'pending'),
  ('e1553200-0000-4000-8000-00000000000a', 'e1550000-0000-4000-8000-00000000000a', 'e1551000-0000-4000-8000-00000000000a', 'media/a/long.mp4', 'long.mp4', 'pending'),
  ('e1553300-0000-4000-8000-00000000000a', 'e1550000-0000-4000-8000-00000000000a', 'e1551100-0000-4000-8000-00000000000a', 'media/a/else.mp4', 'else.mp4', 'pending');
insert into public.media_assets (id, user_id, job_id, storage_path, name, status, duration, has_audio) values
  ('e1553400-0000-4000-8000-00000000000a', 'e1550000-0000-4000-8000-00000000000a', 'e1551000-0000-4000-8000-00000000000a', 'media/a/old.mp4', 'old.mp4', 'ready', 60, true);
insert into public.tasks (user_id, kind, asset_id, job_id, status, attempt_id, request_id)
select 'e1550000-0000-4000-8000-00000000000a', 'probe_media', id, job_id, 'running', id, gen_random_uuid()
from public.media_assets where status = 'pending' and user_id = 'e1550000-0000-4000-8000-00000000000a';
insert into public.credit_ledger (user_id, delta, reason)
select 'e1550000-0000-4000-8000-00000000000a', 5 - public.credit_balance('e1550000-0000-4000-8000-00000000000a'), 'test';

-- Worker: probes finish.
select ok(public.complete_media_probe('e1553000-0000-4000-8000-00000000000a', 'e1553000-0000-4000-8000-00000000000a', 120, 1920, 1080, true, null, true), 'probe of a talk with audio');
select is((select transcript_status from public.media_assets where id = 'e1553000-0000-4000-8000-00000000000a'), 'queued', 'a ready file with audio is queued for its transcript');
select is((select payload ->> 'credits' from public.tasks where kind = 'transcribe_asset' and asset_id = 'e1553000-0000-4000-8000-00000000000a'), '0', 'the automatic run is free');
select is(public.credit_balance('e1550000-0000-4000-8000-00000000000a'), 5, '...and holds no credits');
select ok(public.complete_media_probe('e1553000-0000-4000-8000-00000000000a', 'e1553000-0000-4000-8000-00000000000a', 120, 1920, 1080, true, null, true), 'a repeated probe completion is accepted');
select is((select count(*)::int from public.tasks where kind = 'transcribe_asset' and asset_id = 'e1553000-0000-4000-8000-00000000000a'), 1, '...and does not queue a second transcript');
select ok(public.complete_media_probe('e1553100-0000-4000-8000-00000000000a', 'e1553100-0000-4000-8000-00000000000a', 30, 1920, 1080, true, null, false), 'probe of a silent video');
select is((select transcript_status from public.media_assets where id = 'e1553100-0000-4000-8000-00000000000a'), 'none', 'no audio: nothing to transcribe');
select ok(public.complete_media_probe('e1553200-0000-4000-8000-00000000000a', 'e1553200-0000-4000-8000-00000000000a', 2400, 1920, 1080, true, null, true), 'probe of a 40-minute file');
select is((select transcript_status from public.media_assets where id = 'e1553200-0000-4000-8000-00000000000a'), 'skipped', 'over 30 minutes: skipped, the paid path remains');

-- Daily cap: pretend 179.5 automatic minutes were used today; a 2-minute file no longer fits.
insert into public.media_assets (id, user_id, job_id, storage_path, name, status, duration, has_audio) values
  ('e1553500-0000-4000-8000-00000000000a', 'e1550000-0000-4000-8000-00000000000a', 'e1551000-0000-4000-8000-00000000000a', 'media/a/used.mp4', 'used.mp4', 'ready', 10650, true);
insert into public.tasks (user_id, kind, asset_id, job_id, status, request_id)
values ('e1550000-0000-4000-8000-00000000000a', 'transcribe_asset', 'e1553500-0000-4000-8000-00000000000a', 'e1551000-0000-4000-8000-00000000000a', 'done', gen_random_uuid());
select ok(public.complete_media_probe('e1553300-0000-4000-8000-00000000000a', 'e1553300-0000-4000-8000-00000000000a', 120, 1920, 1080, true, null, true), 'probe after the cap is used');
select is((select transcript_status from public.media_assets where id = 'e1553300-0000-4000-8000-00000000000a'), 'skipped', 'over the daily cap: skipped');
delete from public.tasks where asset_id = 'e1553500-0000-4000-8000-00000000000a';

-- Worker: the talk's transcript.
update public.tasks set status = 'running', attempt_id = 'e1559000-0000-4000-8000-00000000000a'
where kind = 'transcribe_asset' and asset_id = 'e1553000-0000-4000-8000-00000000000a';
select is((select transcript_status from public.media_assets where id = 'e1553000-0000-4000-8000-00000000000a'), 'running', 'status follows the task');
create temp table body as select '[{"text":"um so we built it","words":[{"text":"um","start":1.0,"end":1.2},{"text":"so","start":1.5,"end":1.7},{"text":"we","start":10.0,"end":10.2},{"text":"built","start":10.3,"end":10.6},{"text":"it","start":10.7,"end":10.8}]},{"text":"in a weekend","words":[{"text":"in","start":40.0,"end":40.2},{"text":"a","start":40.3,"end":40.4},{"text":"weekend","start":40.5,"end":41.0}]}]'::text as v;
select is(public.complete_media_transcript((select id from public.tasks where kind = 'transcribe_asset' and asset_id = 'e1553000-0000-4000-8000-00000000000a'),
  'e1559000-0000-4000-8000-00000000000a', (select v from body), 'fake'),
  encode(sha256(convert_to((select v from body), 'UTF8')), 'hex'), 'worker stores the file transcript and returns its hash');
select is((select transcript_status from public.media_assets where id = 'e1553000-0000-4000-8000-00000000000a'), 'ready', 'transcript ready');
select is((select seconds from public.media_transcripts where asset_id = 'e1553000-0000-4000-8000-00000000000a'), 120::numeric, 'stored with the file length (for the cap)');

-- A failed automatic run is visible as failed, and can be asked for again for free.
insert into public.tasks (user_id, kind, asset_id, job_id, status, attempt_id, request_id, payload)
values ('e1550000-0000-4000-8000-00000000000a', 'transcribe_asset', 'e1553400-0000-4000-8000-00000000000a', 'e1551000-0000-4000-8000-00000000000a',
        'running', 'e1559100-0000-4000-8000-00000000000a', gen_random_uuid(), '{"credits":0}');
select ok(public.fail_task((select id from public.tasks where kind = 'transcribe_asset' and asset_id = 'e1553400-0000-4000-8000-00000000000a'),
  'e1559100-0000-4000-8000-00000000000a', 'No speech found.'), 'worker reports a failure');
select is((select transcript_status from public.media_assets where id = 'e1553400-0000-4000-8000-00000000000a'), 'failed', 'failure is visible on the file');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1550000-0000-4000-8000-00000000000a"}';

select is(public.request_media_transcript('e1553400-0000-4000-8000-00000000000a'), 'queued', 'the owner asks again: queued, free');
select throws_ok($$ select public.complete_media_transcript(gen_random_uuid(), null, '[]') $$, '42501', null, 'users cannot call the worker RPC');

-- Reuse in a clip: sliced to the element's window, file seconds kept.
create temp table used as select public.use_media_transcript('e1552000-0000-4000-8000-00000000000a', 'e1553000-0000-4000-8000-00000000000a', 5, 41) as v;
select is((select v ->> 'status' from used), 'ready', 'use: ready');
select is((select body::jsonb from public.editor_transcripts where hash = (select v ->> 'hash' from used)),
  '[{"text":"we built it","words":[{"text":"we","start":10.0,"end":10.2},{"text":"built","start":10.3,"end":10.6},{"text":"it","start":10.7,"end":10.8}]},{"text":"in a weekend","words":[{"text":"in","start":40.0,"end":40.2},{"text":"a","start":40.3,"end":40.4},{"text":"weekend","start":40.5,"end":41.0}]}]'::jsonb,
  'slice keeps words starting inside the window, in file seconds');
select is((select public.use_media_transcript('e1552000-0000-4000-8000-00000000000a', 'e1553400-0000-4000-8000-00000000000a') ->> 'status'), 'pending', 'queued file: pending');
select is((select public.use_media_transcript('e1552000-0000-4000-8000-00000000000a', 'e1553100-0000-4000-8000-00000000000a') ->> 'status'), 'none', 'no audio: none');
select throws_ok($$ select public.use_media_transcript('e1552000-0000-4000-8000-00000000000a', 'e1553300-0000-4000-8000-00000000000a') $$,
  'P0002', null, 'a file of another project is refused');

-- Paid captions on a file that has its transcript: done at once, 0 credits.
create temp table cap as select public.request_media_captions('e1552000-0000-4000-8000-00000000000a', 'e1553000-0000-4000-8000-00000000000a', 0, 30) as v;
select is((select (v ->> 'credits')::int from cap), 0, 'captions of a transcribed file cost nothing');
select is((select status || ':' || (output ->> 'src' like 'assets/transcripts/%.json')::text from public.tasks where id = (select (v ->> 'task_id')::uuid from cap)),
  'done:true', '...and come back finished with a src the inspector already reads');
select is(public.credit_balance('e1550000-0000-4000-8000-00000000000a'), 5, 'no credits moved');

-- Another user sees nothing and cannot use the file.
set local request.jwt.claims = '{"sub":"e1550000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.media_transcripts), 0, 'RLS: another user reads no transcripts');
select throws_ok($$ select public.use_media_transcript('e1552000-0000-4000-8000-00000000000a', 'e1553000-0000-4000-8000-00000000000a') $$,
  null, null, 'another user cannot use the clip or the file');

select * from finish();
rollback;
