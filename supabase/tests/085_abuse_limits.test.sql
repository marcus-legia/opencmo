-- Siết lạm dụng (20260921130000, now on `create_upload_edit`): ba chốt của route nay nằm trong SQL, và huỷ
-- job đang chạy phải tốn tiền.
--
-- Chạy dưới vai `authenticated` với JWT giả — đó là đường PostgREST đi thật, và
-- cũng chính là đường mà một dòng curl đi vòng qua route. Chạy dưới `postgres`
-- sẽ bỏ qua cả RLS lẫn grant, và test xanh ở đó không chứng minh gì.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select no_plan();

-- --------------------------------------------------------------- fixture
insert into auth.users (id, email) values
  ('e5000000-0000-4000-8000-000000000001', 'abuse-a@test.local'),
  ('e5000000-0000-4000-8000-000000000002', 'abuse-b@test.local'),
  ('e5000000-0000-4000-8000-000000000003', 'abuse-c@test.local');

insert into public.credit_ledger (user_id, delta, reason) values
  ('e5000000-0000-4000-8000-000000000001', 500, 'Test top-up'),
  ('e5000000-0000-4000-8000-000000000002', 500, 'Test top-up'),
  ('e5000000-0000-4000-8000-000000000003', 500, 'Test top-up');

-- Dọn hàng đợi mà không cần vai postgres: client không có policy UPDATE trên
-- `jobs`, mọi ghi đi qua RPC — kể cả trong test.
create function pg_temp.drain_jobs(p_user uuid) returns void
language sql security definer set search_path = public as $fn$
  update public.jobs set status = 'done' where user_id = p_user and status in ('queued', 'running');
$fn$;

-- Đặt job sang `running` để kiểm nhánh huỷ-khi-đang-chạy.
create function pg_temp.mark_running(p_job uuid) returns void
language sql security definer set search_path = public as $fn$
  update public.jobs set status = 'running' where id = p_job;
$fn$;

-- `rate_limits` bật RLS và CỐ Ý không có policy nào (20260914091000_web_rls),
-- nên vai `authenticated` đọc ra rỗng chứ không ra lỗi. Đọc qua đây để khẳng
-- định về bộ đếm nói đúng chuyện nó định nói.
create function pg_temp.rate_count(p_user uuid, p_bucket text) returns int
language sql security definer set search_path = public as $fn$
  select count from public.rate_limits
  where user_id = p_user and bucket = p_bucket
  order by window_start desc limit 1;
$fn$;

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

set local role authenticated;
set local request.jwt.claims = '{"sub":"e5000000-0000-4000-8000-000000000001"}';

-- ==================================================== only uploads
-- A link never reaches `jobs.source_url`: nothing on the server fetches a URL the user typed.
select throws_ok(
  $$ select public.create_upload_edit('http://169.254.169.254/latest/meta-data/') $$,
  '22023', 'Upload the video file to edit it.', 'a link is refused in SQL'
);
select throws_ok(
  $$ select public.create_upload_edit('file:///etc/passwd') $$,
  '22023', 'Upload the video file to edit it.', 'file:// is refused'
);
-- Another user's upload is not this user's reservation.
select throws_ok(
  $$ select public.create_upload_edit(pg_temp.upload('e5000000-0000-4000-8000-000000000002', 'theirs.mp4')) $$,
  'P0001', 'That upload is not ready. Please upload it again.', 'someone else''s upload is refused'
);
-- An upload starts one project only.
select throws_ok(
  $$ select public.create_upload_edit(pg_temp.upload(auth.uid(), 'once.mp4'));
     select public.create_upload_edit('storage://' || auth.uid() || '/once.mp4') $$,
  'P0001', 'That upload is not ready. Please upload it again.', 'a consumed upload cannot start a second project'
);

-- ===================================================== trần job đang chạy
select pg_temp.drain_jobs('e5000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.create_upload_edit(pg_temp.upload(auth.uid(), 'cap-1.mp4'));
     select public.create_upload_edit(pg_temp.upload(auth.uid(), 'cap-2.mp4'));
     select public.create_upload_edit(pg_temp.upload(auth.uid(), 'cap-3.mp4')) $$,
  'ba job mở cùng lúc vẫn tạo được'
);

select throws_ok(
  $$ select public.create_upload_edit(pg_temp.upload(auth.uid(), 'cap-4.mp4')) $$,
  'P0001', 'You already have 3 projects in progress. Please wait for one to finish.',
  'job thứ tư bị từ chối — hàng đợi không bị một người chiếm'
);

-- Trần đếm theo job MỞ, không theo tổng số: đóng bớt là tạo tiếp được.
select pg_temp.drain_jobs('e5000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.create_upload_edit(pg_temp.upload(auth.uid(), 'cap-5.mp4')) $$,
  'đóng job cũ thì tạo tiếp được'
);

-- Trần theo TỪNG người: user B không bị user A làm ảnh hưởng.
set local request.jwt.claims = '{"sub":"e5000000-0000-4000-8000-000000000002"}';
select lives_ok(
  $$ select public.create_upload_edit(pg_temp.upload(auth.uid(), 'other-user.mp4')) $$,
  'trần tính riêng từng người'
);
set local request.jwt.claims = '{"sub":"e5000000-0000-4000-8000-000000000001"}';

-- ============================================== rate limit nằm TRONG rpc
--
-- Trước migration này `jobs 10/giờ` chỉ có ở route; gọi thẳng RPC là bỏ qua.
-- User C dùng riêng cho mục này để bộ đếm không lẫn với các ca ở trên.
set local request.jwt.claims = '{"sub":"e5000000-0000-4000-8000-000000000003"}';

create temporary table rate_probe(created int, blocked text) on commit drop;
grant select, insert on rate_probe to authenticated;

do $$
declare i int; v_created int := 0; v_blocked text := null;
begin
  for i in 1..12 loop
    -- Dọn hàng đợi mỗi vòng để chạm trần RATE, không phải trần đồng thời.
    -- Phải qua `pg_temp.drain_jobs`: một UPDATE thẳng ở đây chạy dưới vai
    -- `authenticated`, và `jobs` không có policy UPDATE nào — nó sẽ lặng lẽ
    -- sửa 0 hàng thay vì báo lỗi.
    perform pg_temp.drain_jobs('e5000000-0000-4000-8000-000000000003');
    begin
      perform public.create_upload_edit(pg_temp.upload(auth.uid(), 'rate-' || i || '.mp4'));
      v_created := v_created + 1;
    exception when others then
      v_blocked := sqlerrm;
      exit;
    end;
  end loop;
  insert into rate_probe values (v_created, v_blocked);
end $$;

select is(
  (select created from rate_probe), 10,
  'đúng 10 job qua được trong một giờ khi gọi thẳng RPC'
);

select is(
  (select blocked from rate_probe),
  'Too many projects started. Please wait a while and try again.',
  'lần thứ 11 bị RPC chặn — rate limit không còn phụ thuộc route'
);

-- Lượt thứ 11 có tăng bộ đếm, nhưng `raise` của create_upload_edit cuộn lại cả
-- subtransaction của nó — kể cả dòng `rate_limit_hit` vừa ghi. Nên bộ đếm dừng
-- ở 10: người bị chặn KHÔNG bị tính thêm lượt, và cũng không tự nới thêm.
select is(
  pg_temp.rate_count('e5000000-0000-4000-8000-000000000003', 'jobs'),
  10, 'bộ đếm dừng đúng ở trần; lượt bị từ chối cuộn lại cùng giao dịch'
);

-- ================================== huỷ job đang chạy phải tốn 1 credit
--
-- Hoàn ĐỦ nghĩa là start-rồi-huỷ là một vòng lặp compute miễn phí: worker đã
-- tải và giải mã thật rồi.
set local request.jwt.claims = '{"sub":"e5000000-0000-4000-8000-000000000002"}';
select pg_temp.drain_jobs('e5000000-0000-4000-8000-000000000002');

create temporary table cancel_probe(label text primary key, balance int) on commit drop;
grant select, insert on cancel_probe to authenticated;

do $$
declare v_job public.jobs; v_before int;
begin
  -- Huỷ khi còn `queued`: chưa tốn gì, hoàn đủ.
  v_before := public.credit_balance('e5000000-0000-4000-8000-000000000002');
  v_job := public.create_upload_edit(pg_temp.upload(auth.uid(), 'cancel-queued.mp4'));
  perform public.cancel_job(v_job.id);
  insert into cancel_probe values
    ('queued', public.credit_balance('e5000000-0000-4000-8000-000000000002') - v_before);

  -- Huỷ khi đã `running`: giữ lại đúng 1 credit.
  v_before := public.credit_balance('e5000000-0000-4000-8000-000000000002');
  v_job := public.create_upload_edit(pg_temp.upload(auth.uid(), 'cancel-running.mp4'));
  perform pg_temp.mark_running(v_job.id);
  perform public.cancel_job(v_job.id);
  insert into cancel_probe values
    ('running', public.credit_balance('e5000000-0000-4000-8000-000000000002') - v_before);
end $$;

select is(
  (select balance from cancel_probe where label = 'queued'),
  0, 'huỷ job còn trong hàng đợi thì hoàn đủ — chưa tốn compute nào'
);

select is(
  (select balance from cancel_probe where label = 'running'),
  -1, 'huỷ job đang chạy giữ lại đúng 1 credit'
);

-- Hai vế được ghi thành hai dòng ledger riêng để đối soát đọc được cả hai.
select is(
  (select count(*)::int from public.credit_ledger
   where user_id = 'e5000000-0000-4000-8000-000000000002'
     and reason = 'Cancelled while running'),
  1, 'phần giữ lại là một dòng ledger riêng, không trừ ngầm vào số hoàn'
);

select * from finish();
rollback;
