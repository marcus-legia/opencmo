-- Creem billing: the money path. Event bodies follow real test-mode deliveries (apps/web/lib/fixtures/creem-deliveries.json).
begin;
set search_path = public, extensions;
select no_plan();

insert into auth.users(id,email) values
 ('c5e00000-0000-4000-8000-000000000001','creem-one@test.local'),
 ('c5e00000-0000-4000-8000-000000000002','creem-two@test.local'),
 ('c5e00000-0000-4000-8000-000000000003','creem-three@test.local'),
 ('c5e00000-0000-4000-8000-000000000004','creem-four@test.local'),
 ('c5e00000-0000-4000-8000-000000000005','creem-five@test.local'),
 ('c5e00000-0000-4000-8000-000000000006','creem-six@test.local');

insert into billing_catalog(creem_product_id,slug,kind,plan_id,credits,price_cents,interval,sort) values
 ('prod_month','monthly','plan','starter',580,6900,'month',1),
 ('prod_year','annual','plan','creator',580,69000,'year',2);
insert into billing_catalog(creem_product_id,slug,kind,credits,price_cents,sort) values
 ('prod_pack','credits-200','pack',200,2500,3);

create function pg_temp.u(n int) returns uuid language sql as $$ select ('c5e00000-0000-4000-8000-00000000000'||n)::uuid $$;
create function pg_temp.balance(n int) returns int language sql as $$ select credit_balance from public.profiles where id=pg_temp.u(n) $$;
create function pg_temp.plan(n int) returns text language sql as $$ select plan from public.profiles where id=pg_temp.u(n) $$;

create function pg_temp.sub(n int, sub text, product text, status text, tran text default null, amount int default 6900)
returns jsonb language sql as $$
 select jsonb_build_object('id',sub,'object','subscription','status',status,
  'product',jsonb_build_object('id',product),
  'customer',jsonb_build_object('id','cust_'||n,'email','someone-else@test.local'),
  'metadata',jsonb_build_object('user_id',pg_temp.u(n)),
  'current_period_end_date','2027-11-05T00:00:00Z',
  'last_transaction_id',tran,
  'last_transaction',case when tran is null then null else jsonb_build_object('id',tran,'amount_paid',amount,'currency','USD','order','ord_'||tran) end)
$$;
create function pg_temp.checkout(n int, product text, ord text default null, tran text default null, amount int default 2500)
returns jsonb language sql as $$
 select jsonb_build_object('id','ch_'||coalesce(ord,'sub'),'object','checkout','status','completed',
  'product',jsonb_build_object('id',product),
  'customer',jsonb_build_object('id','cust_'||n,'email','someone-else@test.local'),
  'metadata',jsonb_build_object('user_id',pg_temp.u(n)),
  'order',jsonb_build_object('id',ord,'transaction',tran,'amount_paid',amount,'currency','USD'))
$$;
create function pg_temp.refund(tran text, amount int, id text default null) returns jsonb language sql as $$
 select jsonb_build_object('id',coalesce(id,'ref_'||tran),'object','refund','refund_amount',amount,
  'transaction',jsonb_build_object('id',tran,'customer','ignored'))
$$;

select has_function('public','process_creem_event',array['text','text','timestamp with time zone','jsonb']);
select has_function('public','grant_annual_credits',array['timestamp with time zone','integer']);

-- Access: only the money path's own role reaches the tables and the RPCs; prices are public, retired ones are not.
select ok(not has_table_privilege('authenticated','public.creem_transactions','select'),'users cannot read transactions');
select ok(not has_table_privilege('authenticated','public.creem_subscriptions','select'),'users cannot read subscriptions');
select ok(not has_table_privilege('anon','public.creem_webhook_receipts','select'),'anon cannot read receipts');
select ok(has_table_privilege('service_role','public.creem_transactions','select, insert, update'),'the webhook can write');
select ok(has_table_privilege('anon','public.billing_catalog','select'),'anyone can read prices');
select ok(not has_table_privilege('authenticated','public.billing_catalog','insert'),'users cannot write prices');
select ok(not has_function_privilege('authenticated','public.process_creem_event(text,text,timestamptz,jsonb)','execute'),'users cannot call the RPC');
select ok(not has_function_privilege('authenticated','public.grant_annual_credits(timestamptz,integer)','execute'),'users cannot grant credits');
select ok(not has_function_privilege('authenticated','public.recompute_plan(uuid)','execute'),'users cannot recompute a plan');

-- First purchase in the order measured on real deliveries: paid, then completed.
select is((public.process_creem_event('e1','subscription.paid','2026-11-05 10:00Z',pg_temp.sub(1,'sub_1','prod_month','active','tran_1'))->>'credits')::int,580,'first charge grants');
select is((public.process_creem_event('e2','checkout.completed','2026-11-05 10:00:01Z',pg_temp.checkout(1,'prod_month'))->>'credits')::int,0,'its checkout grants nothing');
select is(pg_temp.balance(1),580,'one purchase, one grant');
select is(pg_temp.plan(1),'starter','paid opens the entitlement without subscription.active');
select is((select creem_customer_id from profiles where id=pg_temp.u(1)),'cust_1','customer linked');
select ok(account_is_paid(pg_temp.u(1)),'a paying account is retained');

-- The other order must land in the same place.
select is((public.process_creem_event('o1','checkout.completed','2026-11-05 10:00Z',pg_temp.checkout(2,'prod_month'))->>'credits')::int,0,'completed first grants nothing');
select is(pg_temp.plan(2),'free','a checkout alone opens nothing');
select is((public.process_creem_event('o2','subscription.paid','2026-11-05 10:00:01Z',pg_temp.sub(2,'sub_2','prod_month','active','tran_2'))->>'credits')::int,580,'paid second still grants');
select is(pg_temp.balance(2),580,'same balance in either order');

-- Redelivery: the same event, and a new event for the same payment.
select is(public.process_creem_event('e1','subscription.paid','2026-11-05 10:00Z',pg_temp.sub(1,'sub_1','prod_month','active','tran_1'))->>'duplicate','true','a replay answers from the receipt');
select is((public.process_creem_event('e1b','subscription.paid','2026-11-05 10:00:02Z',pg_temp.sub(1,'sub_1','prod_month','active','tran_1'))->>'credits')::int,0,'a new event id for the same payment grants nothing');
select is(pg_temp.balance(1),580,'still one grant');

-- A renewal is a new payment. A retired product keeps paying out: someone bought it at the old price.
update billing_catalog set on_sale=false where creem_product_id='prod_month';
select is((public.process_creem_event('r1','subscription.paid','2026-12-05 10:00Z',pg_temp.sub(1,'sub_1','prod_month','active','tran_1b'))->>'credits')::int,580,'a renewal on a retired product grants');
update billing_catalog set on_sale=true where creem_product_id='prod_month';
select is(pg_temp.balance(1),1160,'two payments, two grants');
select throws_ok($$delete from billing_catalog where creem_product_id='prod_month'$$,'55000',null,'a catalogue row cannot be deleted');

-- Money for a product we cannot map must fail, so Creem retries, and leave nothing behind.
select throws_ok($$select public.process_creem_event('u1','subscription.paid','2026-11-05 10:00Z',pg_temp.sub(3,'sub_3x','prod_unknown','active','tran_3x'))$$,'22023','Unknown billing product.','an unmapped payment fails');
select is((select count(*) from creem_webhook_receipts where event_id='u1'),0::bigint,'no receipt, so the retry runs');
select lives_ok($$select public.process_creem_event('u2','subscription.canceled','2026-11-05 10:00Z',pg_temp.sub(3,'sub_3x','prod_unknown','canceled'))$$,'an unmapped lifecycle event is skipped');

-- Credit pack: granted on the checkout, keyed by order.
select is((public.process_creem_event('p1','checkout.completed','2026-11-05 11:00Z',pg_temp.checkout(1,'prod_pack','ord_p','tran_p'))->>'credits')::int,200,'a pack grants on checkout');
select is((public.process_creem_event('p2','checkout.completed','2026-11-05 11:00:01Z',pg_temp.checkout(1,'prod_pack','ord_p','tran_p'))->>'credits')::int,0,'a pack grants once per order');
select is(pg_temp.balance(1),1360,'pack added');

-- Refunds take back what that payment granted, in proportion, never below zero.
select is((public.process_creem_event('f1','refund.created','2026-11-05 12:00Z',pg_temp.refund('tran_p',1250))->>'credits')::int,-100,'half the pack comes back');
select is((public.process_creem_event('f2','refund.created','2026-11-05 12:01Z',pg_temp.refund('tran_p',1250,'ref_2'))->>'credits')::int,-100,'then the rest');
select is((public.process_creem_event('f2b','refund.created','2026-11-05 12:02Z',pg_temp.refund('tran_p',1250,'ref_3'))->>'credits')::int,0,'a pack cannot be clawed past what it granted');
select is(pg_temp.balance(1),1160,'pack gone');
select throws_ok($$select public.process_creem_event('f3','refund.created','2026-11-05 12:00Z',pg_temp.refund('tran_none',100))$$,'22023','Unknown billing transaction.','a refund for an unseen payment fails and retries');

insert into credit_ledger(user_id,delta,reason) values(pg_temp.u(2),-500,'spent in a test');
select is((public.process_creem_event('f4','refund.created','2026-11-05 12:00Z',pg_temp.refund('tran_2',6900))->>'credits')::int,-80,'a refund stops at the balance');
select is(pg_temp.balance(2),0,'the balance never goes negative');

-- A dispute takes back the rest of that payment.
select is((public.process_creem_event('d1','dispute.created','2026-11-05 12:00Z',jsonb_build_object('id','disp_1','transaction',jsonb_build_object('id','tran_1b')))->>'credits')::int,-580,'a dispute claws back');
select is((select refunded_amount from creem_transactions where transaction_id='tran_1b'),6900::bigint,'a dispute counts as the whole payment');

-- Status: scheduled_cancel keeps access, canceled ends it, an older event changes nothing.
select lives_ok($$select public.process_creem_event('s1','subscription.scheduled_cancel','2026-12-06 10:00Z',pg_temp.sub(1,'sub_1','prod_month','scheduled_cancel'))$$,'scheduled_cancel');
select is(pg_temp.plan(1),'starter','scheduled_cancel stays paid');
select lives_ok($$select public.process_creem_event('s2','subscription.canceled','2026-12-06 11:00Z',pg_temp.sub(1,'sub_1','prod_month','canceled'))$$,'canceled');
select is(pg_temp.plan(1),'free','canceled is terminal, unlike Polar');
select lives_ok($$select public.process_creem_event('s3','subscription.active','2026-12-06 10:30Z',pg_temp.sub(1,'sub_1','prod_month','active'))$$,'an older event');
select is(pg_temp.plan(1),'free','an older event does not bring it back');

-- A plan follows what is still held: one subscription ending does not drop the other.
select lives_ok($$select public.process_creem_event('b1','subscription.paid','2026-11-05 10:00Z',pg_temp.sub(3,'sub_3','prod_month','active','tran_3'))$$,'first subscription');
select lives_ok($$select public.process_creem_event('b2','subscription.paid','2026-11-05 11:00Z',pg_temp.sub(3,'sub_3b','prod_year','active','tran_3b',69000))$$,'second subscription');
select is(pg_temp.plan(3),'creator','the better plan wins');
select lives_ok($$select public.process_creem_event('b3','subscription.canceled','2026-11-06 10:00Z',pg_temp.sub(3,'sub_3b','prod_year','canceled'))$$,'the better one ends');
select is(pg_temp.plan(3),'starter','the other still holds');

-- Matching: no metadata falls back to the email; a bad id does not raise; an unknown buyer is skipped.
select is((public.process_creem_event('m1','subscription.paid','2026-11-05 10:00Z',
  jsonb_build_object('id','sub_4','status','active','product',jsonb_build_object('id','prod_month'),
   'customer',jsonb_build_object('id','cust_4','email','creem-four@test.local'),'last_transaction_id','tran_4',
   'last_transaction',jsonb_build_object('id','tran_4','amount_paid',6900)))->>'credits')::int,580,'email fallback without metadata');
select is(pg_temp.balance(4),580,'email fallback credits the account');
select is(public.process_creem_event('m2','subscription.paid','2026-11-05 10:00Z',
  jsonb_build_object('id','sub_x','status','active','product',jsonb_build_object('id','prod_month'),
   'metadata',jsonb_build_object('user_id','not-a-uuid'),
   'customer',jsonb_build_object('id','cust_x','email','nobody@test.local'),'last_transaction_id','tran_x'))->>'skipped','no matching account','a non-uuid id does not raise');

-- Annual: the first month on payment, then one month at a time, and a rerun adds nothing.
select is((public.process_creem_event('a1','subscription.paid','2026-11-05 10:00Z',pg_temp.sub(5,'sub_5','prod_year','active','tran_5',69000))->>'credits')::int,580,'annual grants one month, not twelve');
select is(grant_annual_credits('2026-11-20 10:00Z'),0,'nothing due inside the first month');
select is(grant_annual_credits('2026-12-05 10:00Z'),580,'month two');
select is(grant_annual_credits('2026-12-05 10:00Z'),0,'a rerun is a no-op');
select is(grant_annual_credits('2027-02-06 10:00Z'),1160,'a missed run catches up');
select is(pg_temp.balance(5),2320,'four months granted');
select is((select granted_credits from creem_transactions where transaction_id='tran_5'),2320,'grants count toward the payment');
select is(grant_annual_credits('2030-01-01 10:00Z'),4640,'a year holds twelve grants at most');
select is(pg_temp.balance(5),6960,'twelve months in all');

-- A renewal starts a new year.
select is((public.process_creem_event('a2','subscription.paid','2027-11-05 10:00Z',pg_temp.sub(5,'sub_5','prod_year','active','tran_5b',69000))->>'credits')::int,580,'annual renewal');
select is((select grants_in_period from creem_subscriptions where subscription_id='sub_5'),1,'a new year counts from one');

-- Annual refund and cancel mid-year.
select lives_ok($$select public.process_creem_event('c1','subscription.paid','2026-11-05 10:00Z',pg_temp.sub(6,'sub_6','prod_year','active','tran_6',69000))$$,'annual six');
select is(grant_annual_credits('2026-12-05 10:00Z'),580,'month two for annual six');
select is((public.process_creem_event('c2','refund.created','2026-12-06 10:00Z',pg_temp.refund('tran_6',34500))->>'credits')::int,-580,'half refunded takes half of what was granted');
select is(grant_annual_credits('2027-01-05 10:00Z'),290,'and the rest of the year shrinks with the money');
select is((public.process_creem_event('c3','refund.created','2027-01-06 10:00Z',pg_temp.refund('tran_6',34500,'ref_6b'))->>'credits')::int,-870,'a full refund takes the rest');
select is(pg_temp.balance(6),0,'nothing left');
select is(grant_annual_credits('2027-02-05 10:00Z'),0,'a refunded year grants no more');
select lives_ok($$select public.process_creem_event('c4','subscription.canceled','2027-02-06 10:00Z',pg_temp.sub(6,'sub_6','prod_year','canceled'))$$,'cancel');
select is(grant_annual_credits('2027-06-05 10:00Z'),0,'a canceled year grants no more');
select is(pg_temp.plan(6),'free','and the plan ends');

select * from finish();
rollback;
