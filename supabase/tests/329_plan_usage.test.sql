-- Wave 2 A2 (20270131020000): `plan_usage()` counts the credits a paid founder's work used this period (holds, settles
-- and refunds; grants and older debits do not count), against the plan's monthly allowance; at 100% a new scan is
-- refused with the reset day while drafts still run; a free account is never paused; an annual plan's period is the
-- current month of its year.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(16);

insert into auth.users (id, email) values
  ('e3290000-0000-4000-8000-00000000000a', 'pu-free@test.local'),
  ('e3290000-0000-4000-8000-00000000000b', 'pu-paid@test.local'),
  ('e3290000-0000-4000-8000-00000000000c', 'pu-year@test.local');

insert into public.billing_catalog (creem_product_id, slug, kind, plan_id, credits, price_cents, interval, sort) values
  ('prod_329_month', 'test-329-month', 'plan', 'starter', 100, 6900, 'month', 900),
  ('prod_329_year', 'test-329-year', 'plan', 'starter', 100, 69000, 'year', 901);
insert into public.creem_subscriptions
  (subscription_id, customer_id, user_id, product_id, plan, interval, status, current_period_end, provider_event_at,
   status_priority, event_id, grant_anchor, grants_in_period) values
  ('sub_329_b', 'cus_329_b', 'e3290000-0000-4000-8000-00000000000b', 'prod_329_month', 'starter', 'month', 'active',
   now() + interval '10 days', now(), 0, 'evt_329_b', now() - interval '20 days', 1),
  ('sub_329_c', 'cus_329_c', 'e3290000-0000-4000-8000-00000000000c', 'prod_329_year', 'starter', 'year', 'active',
   now() + interval '300 days', now(), 0, 'evt_329_c', now() - interval '2 months 3 days', 3);
update public.profiles set plan = 'starter'
where id in ('e3290000-0000-4000-8000-00000000000b', 'e3290000-0000-4000-8000-00000000000c');

-- A grant (no ref: not usage) and a debit from before this period.
insert into public.credit_ledger (user_id, delta, reason, external_id) values
  ('e3290000-0000-4000-8000-00000000000b', 500, 'Plan payment', 'test:329:grant');
insert into public.credit_ledger (user_id, delta, reason, ref_kind, ref_id, created_at) values
  ('e3290000-0000-4000-8000-00000000000b', -50, 'Old job', 'job', 'e3290000-0000-4000-8000-0000000000f0', now() - interval '40 days');

-- Free account.
select is((select row(plan, used, allowance, percent, paused)::text from public.plan_usage_for('e3290000-0000-4000-8000-00000000000a')),
  row('free', 0, 0, 0, false)::text, 'a free account has no allowance and is never paused');

select is((select used from public.plan_usage_for('e3290000-0000-4000-8000-00000000000b')), 0,
  'grants and debits from an earlier period are not usage');

select public.credit_hold('e3290000-0000-4000-8000-00000000000b', 'cmo_run', 'e3290000-0000-4000-8000-0000000000f1', 30, 'test');
select is((select used from public.plan_usage_for('e3290000-0000-4000-8000-00000000000b')), 30, 'a hold counts');
select public.credit_settle('e3290000-0000-4000-8000-00000000000b', 'cmo_run', 'e3290000-0000-4000-8000-0000000000f1', 20, 'test');
select is((select used from public.plan_usage_for('e3290000-0000-4000-8000-00000000000b')), 20, 'a settle below the hold gives the rest back');
select public.credit_hold('e3290000-0000-4000-8000-00000000000b', 'cmo_run', 'e3290000-0000-4000-8000-0000000000f2', 10, 'test');
select public.credit_refund('e3290000-0000-4000-8000-00000000000b', 'cmo_run', 'e3290000-0000-4000-8000-0000000000f2', 'test');
select is((select used from public.plan_usage_for('e3290000-0000-4000-8000-00000000000b')), 20, 'a refunded hold is not usage');

select is((select row(plan, "interval", allowance, percent, paused)::text from public.plan_usage_for('e3290000-0000-4000-8000-00000000000b')),
  row('pro', 'month', 100, 20, false)::text, '20 of 100 is 20%');
select is((select resets_at from public.plan_usage_for('e3290000-0000-4000-8000-00000000000b')),
  (select current_period_end from public.creem_subscriptions where subscription_id = 'sub_329_b'),
  'a monthly plan resets at the end of its period');

-- The founder reads their own; nobody calls the helper.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3290000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select row(plan, used, percent)::text from public.plan_usage()), row('pro', 20, 20)::text, 'plan_usage() is the founder''s own');
reset role;
select ok(not has_function_privilege('anon', 'public.plan_usage()', 'execute'), 'anon cannot read usage');
select ok(not has_function_privilege('authenticated', 'public.plan_usage_for(uuid)', 'execute'), 'users cannot read another account');

-- 100%: scans pause, drafts do not.
select public.credit_hold('e3290000-0000-4000-8000-00000000000b', 'cmo_run', 'e3290000-0000-4000-8000-0000000000f3', 80, 'test');
select is((select row(percent, paused)::text from public.plan_usage_for('e3290000-0000-4000-8000-00000000000b')),
  row(100, true)::text, 'at 100% the account is paused');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3290000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_like($$ select public.enqueue_cmo_run('sales_scan', '{}') $$,
  'You used this month''s allowance. New scans start again on %', 'a paused account cannot start a scan');
select throws_like($$ select public.enqueue_cmo_run('competitor_research', '{}') $$,
  'You used this month''s allowance.%', 'nor research');
select is((select credits from public.enqueue_cmo_run('post_draft', '{}')), 1, 'a draft still runs');
reset role;
select is((select count(*)::int from public.cmo_runs where user_id = 'e3290000-0000-4000-8000-00000000000b' and kind = 'sales_scan'), 0,
  'no scan was queued');

-- Annual: the period is the current month of the year, the allowance is the monthly grant.
select is((select row("interval", allowance, resets_at)::text from public.plan_usage_for('e3290000-0000-4000-8000-00000000000c')),
  row('year', 100, (select grant_anchor + interval '3 months' from public.creem_subscriptions where subscription_id = 'sub_329_c'))::text,
  'an annual plan resets a month after the start of its current month');

select * from finish();
rollback;
