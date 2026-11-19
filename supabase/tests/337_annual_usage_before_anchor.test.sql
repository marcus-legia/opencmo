-- Review of #238, finding 8 (20270131020008): a yearly subscription not anchored yet measures the month running now,
-- not a month eleven months away.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(2);

insert into auth.users (id, email) values ('e3370000-0000-4000-8000-00000000000a', 'au-a@test.local');
insert into public.billing_catalog (creem_product_id, slug, kind, plan_id, credits, price_cents, interval, sort) values
  ('prod_337year', 'test-337-year', 'plan', 'creator', 100, 69000, 'year', 937);
insert into public.creem_subscriptions
  (subscription_id, customer_id, user_id, product_id, plan, interval, status, current_period_end, provider_event_at,
   status_priority, event_id) values
  ('sub_337_a', 'cus_337_a', 'e3370000-0000-4000-8000-00000000000a', 'prod_337year', 'creator', 'year', 'active',
   now() + interval '365 days', now(), 0, 'evt_337_a');
update public.profiles set plan = 'creator' where id = 'e3370000-0000-4000-8000-00000000000a';

select ok((select resets_at from public.plan_usage_for('e3370000-0000-4000-8000-00000000000a')) <= now() + interval '1 month',
  'the reset is within a month, not a year away');
select ok((select resets_at from public.plan_usage_for('e3370000-0000-4000-8000-00000000000a')) > now(),
  'and still ahead');

select * from finish();
rollback;
