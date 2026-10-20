-- Output options of an upload job: aspect and captions from the caller, layout and caption preset
-- from their defaults; one storage window for every project.
--
-- Chạy dưới vai `authenticated` với JWT giả, cùng luật với 020/050: đó là
-- đường PostgREST đi thật. Chạy dưới `postgres` sẽ bỏ qua cả RLS lẫn grant, và
-- test xanh ở đó không chứng minh gì.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

-- --------------------------------------------------------------- fixture
insert into auth.users (id, email)
values ('d0000000-0000-4000-8000-00000000000d', 'd@test.local');

insert into public.credit_ledger (user_id, delta, reason)
values ('d0000000-0000-4000-8000-00000000000d', 500, 'Test top-up');

-- An upload the user reserved and finished: what `create_upload_edit` consumes.
create function pg_temp.upload(p_user uuid, p_name text) returns text
language plpgsql security definer set search_path = public as $$
begin
  insert into public.upload_reservations (user_id, bucket, object_name, declared_size, content_type)
  values (p_user, 'sources', p_user || '/' || p_name, 1000, 'video/mp4');
  insert into storage.objects (bucket_id, name, metadata)
  values ('sources', p_user || '/' || p_name, '{"size": 100, "mimetype": "video/mp4"}');
  return 'storage://' || p_user || '/' || p_name;
end;
$$;

-- `create_upload_edit` allows 3 jobs `queued`/`running` at once; this file checks its parameters,
-- not that cap, so the queue is drained before each job.
create function pg_temp.drain_jobs(p_user uuid) returns void
language sql security definer set search_path = public as $fn$
  update public.jobs set status = 'done' where user_id = p_user and status in ('queued', 'running');
$fn$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-00000000000d"}';

-- ------------------------------------------------------------------ cột
select hasnt_column('public', 'jobs', 'mode', 'jobs.mode is gone');
select hasnt_column('public', 'jobs', 'segments', 'jobs.segments is gone');
select hasnt_column('public', 'jobs', 'clip_length', 'jobs.clip_length is gone');

-- --------------------------------------------------------------- mặc định
create temporary table made on commit drop as
select * from public.create_upload_edit(pg_temp.upload('d0000000-0000-4000-8000-00000000000d', 'def.mp4'));
select is((select aspect from made), '9:16', 'vertical by default');
select is((select layout from made), 'auto', 'layout stays auto');
select is((select caption_preset from made), 'bold', 'caption preset stays bold');
select is((select captions from made), true, 'captions on by default');
select is((select clips_requested from made), 1, 'one editable video per upload');

-- ------------------------------------------------------------- giữ lựa chọn
select pg_temp.drain_jobs('d0000000-0000-4000-8000-00000000000d');
select is(
  (select row(aspect, captions)::text
   from public.create_upload_edit(pg_temp.upload('d0000000-0000-4000-8000-00000000000d', 'keep.mp4'), '16:9', false)),
  '(16:9,f)', 'the chosen aspect and captions are kept'
);

-- ------------------------------------------------ vòng đời file
reset role;
update public.jobs set status = 'failed', finished_at = '2026-09-19 12:00:00+00'
where id = (select id from made);
select is(
  (select expires_at from public.jobs where id = (select id from made)),
  '2026-09-26 12:00:00+00'::timestamptz,
  'a finished project keeps its files seven days'
);

update public.jobs set status = 'queued', finished_at = null where id = (select id from made);
select ok(
  (select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
   from public.jobs where id = (select id from made)),
  'a retry opens a fresh seven-day window'
);

-- ----------------------------------------------------- constraint của bảng
-- Hàm không phải chốt duy nhất: `jobs` còn những đường ghi khác (worker, retry).
select throws_ok(
  $$ insert into public.jobs (user_id, source_url, aspect)
     values ('d0000000-0000-4000-8000-00000000000d', 'storage://d0000000-0000-4000-8000-00000000000d/x.mp4', '4:3') $$,
  '23514', null, 'constraint chặn aspect lạ ghi thẳng vào bảng'
);
select throws_ok(
  $$ insert into public.clips (job_id, idx, start_seconds, end_seconds, source_start, source_end, kind)
     values ((select id from made), 5, 0, 1, 0, 1, 'moment') $$,
  '23514', null, 'a moment clip cannot be written any more'
);

select * from finish();
rollback;
