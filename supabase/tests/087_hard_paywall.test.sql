-- Hard paywall (20260921150000): tài khoản mới bắt đầu từ 0.
--
-- Quà đăng ký cũ cộng 30 credit cho MỌI hàng `auth.users` mới, mà hàng đó sinh
-- ra ngay lúc người dùng bấm "gửi link" — chưa cần mở hòm thư. Đó là giá của
-- một địa chỉ email, trả bằng tiền Modal thật.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;
select no_plan();

insert into auth.users(id, email)
values ('e7000000-0000-4000-8000-000000000001', 'paywall@test.local');

select is(public.signup_credits(), 0, 'không tặng credit khi đăng ký');

-- Hồ sơ vẫn PHẢI được tạo: số dư, plan và watermark đều đọc từ đây, và
-- `handle_new_user()` là chỗ duy nhất tạo nó.
select is(
  (select count(*)::int from public.profiles where id = 'e7000000-0000-4000-8000-000000000001'),
  1, 'hồ sơ vẫn được tạo ngay khi đăng ký'
);

select is(
  (select email from public.profiles where id = 'e7000000-0000-4000-8000-000000000001'),
  'paywall@test.local', 'hồ sơ mang đúng email'
);

select is(
  (select credit_balance from public.profiles where id = 'e7000000-0000-4000-8000-000000000001'),
  0, 'số dư khởi điểm là 0'
);

-- Không phải "một dòng delta 0" mà là KHÔNG CÓ DÒNG NÀO: trang Credit history
-- mở ra phải trống, không phải có sẵn một mục vô nghĩa.
select is(
  (select count(*)::int from public.credit_ledger
   where user_id = 'e7000000-0000-4000-8000-000000000001'),
  0, 'không có dòng ledger nào được sinh ra lúc đăng ký'
);

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

-- Và đó là ý nghĩa thật của "hard": đăng ký xong chưa tạo được job.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e7000000-0000-4000-8000-000000000001"}';

select throws_ok(
  $$ select public.create_upload_edit(pg_temp.upload(auth.uid(), 'paywall.mp4')) $$,
  'P0001', 'Not enough credits: 10 needed, 0 left. Top up on the Credits page.',
  'tài khoản mới không tạo được job cho tới khi mua gói'
);

reset role;

-- Mua gói xong thì mở khoá — đường duy nhất vào sản phẩm phải thật sự thông.
insert into public.credit_ledger(user_id, delta, reason)
values ('e7000000-0000-4000-8000-000000000001', 150, 'Starter purchase');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e7000000-0000-4000-8000-000000000001"}';

select lives_ok(
  $$ select public.create_upload_edit(pg_temp.upload(auth.uid(), 'paywall-paid.mp4')) $$,
  'nạp credit xong thì tạo job được ngay'
);

select * from finish();
rollback;
