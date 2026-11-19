-- Wave 4a A1 (20270202010000): `my_usage_state()` tells a screen whether included work is stopped and why. A free
-- account has its free scan, then is blocked once it is used; a paid account under its allowance runs everything; at
-- 100% scans and research stop while drafts still run, with the reset date; an annual plan resets a month after the
-- start of its current month.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(15);

insert into auth.users (id, email) values
  ('e3470000-0000-4000-8000-00000000000a', 'us-free@test.local'),
  ('e3470000-0000-4000-8000-00000000000b', 'us-paid@test.local'),
  ('e3470000-0000-4000-8000-00000000000c', 'us-year@test.local');

insert into public.billing_catalog (creem_product_id, slug, kind, plan_id, credits, price_cents, interval, sort) values
  ('prod_347_month', 'test-347-month', 'plan', 'starter', 100, 6900, 'month', 900),
  ('prod_347_year', 'test-347-year', 'plan', 'starter', 100, 69000, 'year', 901);
insert into public.creem_subscriptions
  (subscription_id, customer_id, user_id, product_id, plan, interval, status, current_period_end, provider_event_at,
   status_priority, event_id, grant_anchor, grants_in_period) values
  ('sub_347_b', 'cus_347_b', 'e3470000-0000-4000-8000-00000000000b', 'prod_347_month', 'starter', 'month', 'active',
   now() + interval '10 days', now(), 0, 'evt_347_b', now() - interval '20 days', 1),
  ('sub_347_c', 'cus_347_c', 'e3470000-0000-4000-8000-00000000000c', 'prod_347_year', 'starter', 'year', 'active',
   now() + interval '300 days', now(), 0, 'evt_347_c', now() - interval '2 months 3 days', 3);
update public.profiles set plan = 'starter'
where id in ('e3470000-0000-4000-8000-00000000000b', 'e3470000-0000-4000-8000-00000000000c');

create function pg_temp.state_of(p_user uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.my_usage_state();
  execute 'reset role';
  return v;
end $$;

-- Free, before onboarding wrote the product document: the scan is still to come, nothing is stopped.
select is(pg_temp.state_of('e3470000-0000-4000-8000-00000000000a') ->> 'free_scan', 'not_ready',
  'a free account without its product document waits for its free scan');

insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e3470000-0000-4000-8000-00000000000a', 'product', 1, '{}', 'agent');
select is(
  (select jsonb_build_object('plan', s->'plan', 'free_scan', s->'free_scan', 'blocked', s->'blocked')
   from pg_temp.state_of('e3470000-0000-4000-8000-00000000000a') s),
  '{"plan": "free", "free_scan": "available", "blocked": false}'::jsonb,
  'a free account with its product document has its free scan');

-- Onboarding's free plan and first draft are done; the scan is running.
insert into public.cmo_runs (user_id, kind, status, credits) values
  ('e3470000-0000-4000-8000-00000000000a', 'plan_week', 'done', 0),
  ('e3470000-0000-4000-8000-00000000000a', 'post_draft', 'done', 0),
  ('e3470000-0000-4000-8000-00000000000a', 'sales_scan', 'running', 0);
select is(pg_temp.state_of('e3470000-0000-4000-8000-00000000000a') ->> 'free_scan', 'running', 'a free scan in flight');

update public.cmo_runs set status = 'done', output = '{"verdict": "found"}'
where user_id = 'e3470000-0000-4000-8000-00000000000a' and kind = 'sales_scan';
select is(
  (select jsonb_build_object('blocked', s->'blocked', 'reason', s->'reason', 'free_scan', s->'free_scan',
     'resets_at', s->'resets_at') from pg_temp.state_of('e3470000-0000-4000-8000-00000000000a') s),
  '{"blocked": true, "reason": "free_scan_used", "free_scan": "used", "resets_at": null}'::jsonb,
  'after a free scan that found people, a free account is blocked and nothing resets');
select ok(pg_temp.state_of('e3470000-0000-4000-8000-00000000000a') -> 'stopped' ?& array['sales_scan', 'reply_drafts', 'post_drafts'],
  'scans, reply drafts and post drafts stop for a free account after its free run');
select is(pg_temp.state_of('e3470000-0000-4000-8000-00000000000a') -> 'still_works', '["read", "edit", "copy_drafts"]'::jsonb,
  'reading, editing and copying drafts still work');

-- A free scan that found no one gives one more try (wave 2): not blocked.
update public.cmo_runs set output = '{"verdict": "none"}'
where user_id = 'e3470000-0000-4000-8000-00000000000a' and kind = 'sales_scan';
select is(pg_temp.state_of('e3470000-0000-4000-8000-00000000000a') ->> 'free_scan', 'available',
  'a free scan that found no one leaves one more');

-- Paid, under the allowance. The plan's grant carries no ref, so it is not usage.
insert into public.credit_ledger (user_id, delta, reason, external_id) values
  ('e3470000-0000-4000-8000-00000000000b', 500, 'Plan payment', 'test:347:grant');
select public.credit_hold('e3470000-0000-4000-8000-00000000000b', 'cmo_run', 'e3470000-0000-4000-8000-0000000000f1', 40, 'test');
select is(
  (select jsonb_build_object('plan', s->'plan', 'interval', s->'interval', 'percent', s->'percent', 'blocked', s->'blocked',
     'stopped', s->'stopped', 'free_scan', s->'free_scan') from pg_temp.state_of('e3470000-0000-4000-8000-00000000000b') s),
  '{"plan": "pro", "interval": "month", "percent": 40, "blocked": false, "stopped": [], "free_scan": null}'::jsonb,
  'a paid account at 40% runs everything');
select ok(pg_temp.state_of('e3470000-0000-4000-8000-00000000000b') -> 'still_works' ?& array['sales_scan', 'research', 'post_drafts', 'reply_drafts'],
  'scans, research and drafts all work under the allowance');

-- Paid, at 100%.
select public.credit_hold('e3470000-0000-4000-8000-00000000000b', 'cmo_run', 'e3470000-0000-4000-8000-0000000000f2', 60, 'test');
select is(
  (select jsonb_build_object('percent', s->'percent', 'blocked', s->'blocked', 'reason', s->'reason', 'stopped', s->'stopped')
   from pg_temp.state_of('e3470000-0000-4000-8000-00000000000b') s),
  '{"percent": 100, "blocked": true, "reason": "allowance_used", "stopped": ["sales_scan", "research"]}'::jsonb,
  'at 100% scans and research stop');
select is(pg_temp.state_of('e3470000-0000-4000-8000-00000000000b') -> 'still_works',
  '["read", "edit", "copy_drafts", "post_drafts", "reply_drafts"]'::jsonb, 'at 100% drafts still run');
select is((pg_temp.state_of('e3470000-0000-4000-8000-00000000000b') ->> 'resets_at')::timestamptz,
  (select current_period_end from public.creem_subscriptions where subscription_id = 'sub_347_b'),
  'the reset is the end of the monthly period');

-- Annual.
select is(
  (select jsonb_build_object('interval', s->'interval', 'allowance', s->'allowance', 'blocked', s->'blocked')
   from pg_temp.state_of('e3470000-0000-4000-8000-00000000000c') s),
  '{"interval": "year", "allowance": 100, "blocked": false}'::jsonb, 'an annual plan measures its monthly grant');
select is((pg_temp.state_of('e3470000-0000-4000-8000-00000000000c') ->> 'resets_at')::timestamptz,
  (select grant_anchor + interval '3 months' from public.creem_subscriptions where subscription_id = 'sub_347_c'),
  'an annual plan resets a month after the start of its current month');

select ok(not has_function_privilege('anon', 'public.my_usage_state()', 'execute'), 'anon cannot read usage state');

select * from finish();
rollback;
