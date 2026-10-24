-- Khớp người mua bằng `customer_external_id`, và `profiles.email` không lỗi thời.
--
-- Hai đường hỏng mà file này đóng đều có CÙNG hậu quả và đều IM LẶNG: tiền vào,
-- credit không cộng, route trả 200 nên Polar không gửi lại.
begin;
set search_path = public, extensions;
select no_plan();

insert into auth.users(id, email) values
 ('e6000000-0000-4000-8000-000000000001', 'ext-login@test.local'),
 ('e6000000-0000-4000-8000-000000000002', 'ext-rename@test.local'),
 ('e6000000-0000-4000-8000-000000000003', 'ext-fallback@test.local'),
 ('e6000000-0000-4000-8000-000000000004', 'ext-ghost@test.local');

-- Số dư kỳ vọng viết qua `signup_credits()` chứ không gõ số: quà đăng ký là một
-- quyết định sản phẩm và nó sẽ đổi. Thứ file này kiểm là "credit về ĐÚNG tài
-- khoản", không phải "credit bằng đúng bao nhiêu".

create function pg_temp.paid(
  p_event text, p_customer text, p_payload jsonb
) returns jsonb language sql as $$
  select public.process_polar_event(
    p_event, 'order.paid', '2026-09-21 10:00Z',
    jsonb_build_object(
      'id', 'order-' || p_event,
      'customer_id', p_customer,
      'product_id', 'sql-product',
      'total_amount', 1500,
      'currency', 'usd'
    ) || p_payload,
    'starter', 150, null)
$$;

-- ============================================ khớp bằng external_id, không email
--
-- Người mua gõ ở Polar một email KHÁC email đăng nhập. Trước migration này đó
-- là 'no matching account' và tiền biến mất khỏi tầm nhìn.
select is(
  pg_temp.paid('ext-1', 'cus-ext-1', jsonb_build_object(
    'customer', jsonb_build_object(
      'id', 'cus-ext-1',
      'email', 'someone-else@gmail.com',
      'external_id', 'e6000000-0000-4000-8000-000000000001'
    )))->>'skipped',
  null, 'email lệch không còn làm rơi giao dịch'
);

select is(
  (select credit_balance from profiles where id = 'e6000000-0000-4000-8000-000000000001'),
  public.signup_credits() + 150, 'credit về đúng tài khoản theo external_id'
);

select is(
  (select user_id from polar_customers where customer_id = 'cus-ext-1'),
  'e6000000-0000-4000-8000-000000000001'::uuid,
  'liên kết khách hàng khoá theo external_id'
);

-- `external_id` là chuỗi tuỳ ý bên Polar. Không phải uuid thì phải rơi êm về
-- email, không được ném 22P02 — ném là 500 và Polar retry vĩnh viễn.
select is(
  pg_temp.paid('ext-junk', 'cus-junk', jsonb_build_object(
    'customer', jsonb_build_object(
      'id', 'cus-junk',
      'email', 'ext-fallback@test.local',
      'external_id', 'not-a-uuid-at-all'
    )))->>'skipped',
  null, 'external_id rác rơi về khớp email thay vì ném lỗi'
);

select is(
  (select credit_balance from profiles where id = 'e6000000-0000-4000-8000-000000000003'),
  public.signup_credits() + 150, 'nhánh lùi theo email vẫn chạy'
);

-- external_id trỏ vào một tài khoản không tồn tại: vẫn phải rơi về email.
select is(
  pg_temp.paid('ext-ghost', 'cus-ghost', jsonb_build_object(
    'customer', jsonb_build_object(
      'id', 'cus-ghost',
      'email', 'ext-ghost@test.local',
      'external_id', 'e6000000-0000-4000-8000-0000000000ff'
    )))->>'skipped',
  null, 'external_id trỏ vào tài khoản đã xoá thì rơi về email'
);

-- ==================================== profiles.email theo kịp auth.users
select is(
  (select email from profiles where id = 'e6000000-0000-4000-8000-000000000002'),
  'ext-rename@test.local', 'email ban đầu do handle_new_user ghi'
);

update auth.users set email = 'ext-renamed@test.local'
where id = 'e6000000-0000-4000-8000-000000000002';

select is(
  (select email from profiles where id = 'e6000000-0000-4000-8000-000000000002'),
  'ext-renamed@test.local', 'đổi email trong auth thì profiles theo kịp'
);

-- Và đó chính là lý do trigger tồn tại: nhánh lùi theo email phải tìm được chủ
-- tài khoản bằng địa chỉ MỚI.
select is(
  pg_temp.paid('after-rename', 'cus-renamed', jsonb_build_object(
    'customer', jsonb_build_object(
      'id', 'cus-renamed',
      'email', 'ext-renamed@test.local'
    )))->>'skipped',
  null, 'mua bằng email mới vẫn khớp đúng tài khoản'
);

-- ========================================== a second customer for a linked account
--
-- The external id is set by our own checkout link, so an order carrying it belongs to that account even when
-- the account is already linked to another Polar customer (an earlier purchase under another email). It used
-- to answer 200 "skipped": Polar never retried and the payment was lost. The first link stays as it is.
select is(
  pg_temp.paid('second-customer', 'cus-other', jsonb_build_object(
    'customer', jsonb_build_object(
      'id', 'cus-other',
      'email', 'nobody@test.local',
      'external_id', 'e6000000-0000-4000-8000-000000000001'
    )))->>'skipped',
  null, 'an order with our external id is credited despite another linked customer'
);

select is(
  (select credit_balance from profiles where id = 'e6000000-0000-4000-8000-000000000001'),
  public.signup_credits() + 300, 'the second order is credited to the account'
);

select is(
  (select polar_customer_id from profiles where id = 'e6000000-0000-4000-8000-000000000001'),
  'cus-ext-1', 'the first customer link is kept'
);

select is(
  (select count(*)::int from polar_webhook_receipts where event_id = 'second-customer'),
  1, 'the event has a receipt'
);

select is(
  (select user_id from polar_customers where customer_id = 'cus-other'),
  'e6000000-0000-4000-8000-000000000001'::uuid, 'the second customer is mapped to the account'
);

-- Its later refund carries no external id and an email of another account: it still reaches this one.
select is(
  public.process_polar_event('second-customer-refund', 'order.refunded', '2026-09-21 11:00Z',
    jsonb_build_object('id', 'order-second-customer', 'customer_id', 'cus-other',
      'customer', jsonb_build_object('id', 'cus-other', 'email', 'ext-fallback@test.local'),
      'refunded_amount', 1500, 'refunded_tax_amount', 0),
    null, null, null)->>'skipped',
  null, 'a later event of the second customer is not skipped'
);
select is(
  (select refunded_amount from polar_purchases where order_id = 'order-second-customer'),
  1500::bigint, 'the refund is recorded on the second order'
);

-- Matched only by email, a second customer proves nothing about the account: still skipped.
select is(
  pg_temp.paid('email-only', 'cus-email-only', jsonb_build_object(
    'customer', jsonb_build_object(
      'id', 'cus-email-only',
      'email', 'ext-fallback@test.local'
    )))->>'skipped',
  'account already linked', 'a second customer matched by email is skipped'
);

-- =============================================================== quyền hàm
select ok(not has_function_privilege('anon',
  'public.sync_profile_email()', 'execute'), 'anon không gọi được đồng bộ email');
select ok(not has_function_privilege('authenticated',
  'public.sync_profile_email()', 'execute'), 'user không gọi được đồng bộ email');

select * from finish();
rollback;
