-- Wave 2 A6 and A7 (20270131020004): a credit pack paid this period raises this period's allowance and lifts the
-- pause (net of a claw-back; last month's pack does not count); the annual switch finds the founder's own live monthly
-- subscription and the annual product, and refuses everything else.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email) values
  ('e3330000-0000-4000-8000-00000000000a', 'pk-a@test.local'),
  ('e3330000-0000-4000-8000-00000000000b', 'pk-b@test.local'),
  ('e3330000-0000-4000-8000-00000000000c', 'pk-c@test.local');
insert into public.billing_catalog (creem_product_id, slug, kind, plan_id, credits, price_cents, interval, sort) values
  ('prod_333month', 'test-333-month', 'plan', 'starter', 100, 6900, 'month', 900),
  ('prod_333year', 'test-333-year', 'plan', 'creator', 100, 69000, 'year', 901),
  ('prod_333yearoff', 'test-333-year-off', 'plan', 'creator', 100, 59000, 'year', 902);
update public.billing_catalog set on_sale = false where creem_product_id = 'prod_333yearoff';
insert into public.billing_catalog (creem_product_id, slug, kind, credits, price_cents, sort) values
  ('prod_333pack', 'test-333-pack', 'pack', 50, 2500, 903);
insert into public.creem_subscriptions
  (subscription_id, customer_id, user_id, product_id, plan, interval, status, current_period_end, provider_event_at,
   status_priority, event_id) values
  ('sub_333_a', 'cus_333_a', 'e3330000-0000-4000-8000-00000000000a', 'prod_333month', 'starter', 'month', 'active',
   now() + interval '10 days', now(), 0, 'evt_333_a'),
  ('sub_333_b', 'cus_333_b', 'e3330000-0000-4000-8000-00000000000b', 'prod_333year', 'creator', 'year', 'active',
   now() + interval '300 days', now(), 0, 'evt_333_b');
update public.profiles set plan = 'starter' where id = 'e3330000-0000-4000-8000-00000000000a';
update public.profiles set plan = 'creator' where id = 'e3330000-0000-4000-8000-00000000000b';
insert into public.credit_ledger (user_id, delta, reason, external_id) values
  ('e3330000-0000-4000-8000-00000000000a', 500, 'Plan payment', 'test:333:grant');

-- A6: paused at 100 of 100, then a pack.
select public.credit_hold('e3330000-0000-4000-8000-00000000000a', 'cmo_run', 'e3330000-0000-4000-8000-0000000000f1', 100, 'test');
select is((select paused from public.plan_usage_for('e3330000-0000-4000-8000-00000000000a')), true, 'paused at 100%');
insert into public.creem_transactions (transaction_id, customer_id, user_id, product_id, amount, granted_credits, clawed_credits, paid_at) values
  ('tran_333_old', 'cus_333_a', 'e3330000-0000-4000-8000-00000000000a', 'prod_333pack', 2500, 50, 0, now() - interval '40 days');
select is((select allowance from public.plan_usage_for('e3330000-0000-4000-8000-00000000000a')), 100, 'last month''s pack does not count');
insert into public.creem_transactions (transaction_id, customer_id, user_id, product_id, amount, granted_credits, clawed_credits, paid_at) values
  ('tran_333_pack', 'cus_333_a', 'e3330000-0000-4000-8000-00000000000a', 'prod_333pack', 2500, 50, 0, now());
select is((select row(allowance, percent, paused)::text from public.plan_usage_for('e3330000-0000-4000-8000-00000000000a')),
  row(150, 66, false)::text, 'a pack this period adds its credits and lifts the pause');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3330000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select credits from public.enqueue_cmo_run('sales_scan', '{}')), 5, 'a scan runs again');
reset role;
update public.creem_transactions set clawed_credits = 50 where transaction_id = 'tran_333_pack';
select is((select allowance from public.plan_usage_for('e3330000-0000-4000-8000-00000000000a')), 100, 'a refunded pack no longer counts');

-- A7: the annual switch.
select ok(not has_function_privilege('anon', 'public.billing_switch_target(text)', 'execute'), 'anon cannot ask');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3330000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select row(subscription_id, product_id)::text from public.billing_switch_target('test-333-year')),
  row('sub_333_a', 'prod_333year')::text, 'a monthly founder gets their own subscription and the annual product');
select throws_ok($$ select * from public.billing_switch_target('test-333-month') $$, '22023', null, 'only to a yearly plan');
select throws_ok($$ select * from public.billing_switch_target('test-333-year-off') $$, '22023', null, 'only to one on sale');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3330000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select * from public.billing_switch_target('test-333-year') $$, '22023',
  'You are already on the annual plan.', 'not twice');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3330000-0000-4000-8000-00000000000c","role":"authenticated"}';
select throws_ok($$ select * from public.billing_switch_target('test-333-year') $$, 'P0002', null, 'a free account has nothing to switch');
reset role;
update public.creem_subscriptions set status = 'scheduled_cancel' where subscription_id = 'sub_333_a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3330000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select * from public.billing_switch_target('test-333-year') $$, 'P0001', null,
  'a plan being cancelled is not switched');
reset role;

select * from finish();
rollback;
