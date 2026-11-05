-- Polar is gone, and what replaced its checks still works.
begin;
set search_path = public, extensions;
select no_plan();

select hasnt_table('public','polar_customers','polar_customers is gone');
select hasnt_table('public','polar_purchases','polar_purchases is gone');
select hasnt_table('public','polar_subscriptions','polar_subscriptions is gone');
select hasnt_table('public','polar_webhook_receipts','polar_webhook_receipts is gone');
select hasnt_column('public','profiles','polar_customer_id','the profile column is gone');
select hasnt_function('public','process_polar_event','the RPC is gone');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ilike '%polar%'),
  0::bigint,'no function names Polar any more');
select lives_ok($$select public.purge_stale_rate_limits()$$,'the cleanup still runs');

select * from finish();
rollback;
