-- Creem billing, next to Polar: docs/plans/billing/2026-11-04-polar-to-creem-plan.md.
--
-- Facts measured on real test-mode deliveries (2026-11-05) that shape this file:
--   * `subscription.paid` fires for the first charge too, and arrives BEFORE `checkout.completed`. Credits for a
--     subscription therefore hang on `subscription.paid` alone, and it must match the buyer by itself.
--   * No `subscription.active` fires on a first purchase, so `subscription.paid` also opens the entitlement.
--   * `metadata.user_id` from our checkout is on every subscription event.
--   * Event order comes from the envelope's `created_at`: it is the only timestamp every event type carries.

-- The catalogue: what each Creem product grants. Test and live product ids differ, so no migration seeds it
-- (scripts/creem-catalog.mjs fills a local stack).
create table public.billing_catalog (
  creem_product_id text primary key,
  slug text not null unique,
  kind text not null check (kind in ('plan', 'pack')),
  plan_id text check (plan_id in ('starter', 'creator')),
  -- A plan's credits are per MONTH, also on an annual plan (`grant_annual_credits`).
  credits integer not null check (credits > 0),
  price_cents integer not null check (price_cents > 0),
  interval text check (interval in ('month', 'year')),
  on_sale boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  constraint billing_catalog_kind_shape check (
    (kind = 'plan' and plan_id is not null and interval is not null)
    or (kind = 'pack' and plan_id is null and interval is null)
  )
);
alter table public.billing_catalog enable row level security;
-- Prices are public: the landing page reads them without a session. Retired rows stay private.
create policy billing_catalog_read on public.billing_catalog for select to anon, authenticated using (on_sale);
revoke all on public.billing_catalog from anon, authenticated;
grant select on public.billing_catalog to anon, authenticated;
grant select, insert, update, delete on public.billing_catalog to service_role;

-- Someone may still renew on a retired product, and an unmapped product gets no credits. A row is only ever retired.
create function public.billing_catalog_refuse_delete() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  raise exception 'A billing product cannot be deleted. Set on_sale to false instead.' using errcode = '55000';
end;
$$;
revoke all on function public.billing_catalog_refuse_delete() from public, anon, authenticated;
create trigger billing_catalog_no_delete before delete on public.billing_catalog
  for each row execute function public.billing_catalog_refuse_delete();

alter table public.profiles add column creem_customer_id text;
create unique index profiles_creem_customer_unique on public.profiles (creem_customer_id) where creem_customer_id is not null;

create table public.creem_customers (
  customer_id text primary key,
  user_id uuid references public.profiles(id) on delete set null
);

create table public.creem_subscriptions (
  subscription_id text primary key,
  customer_id text not null,
  user_id uuid references public.profiles(id) on delete set null,
  product_id text not null,
  plan text not null check (plan in ('starter', 'creator')),
  interval text not null check (interval in ('month', 'year')),
  status text not null check (status in ('active', 'trialing', 'paused', 'past_due', 'unpaid', 'scheduled_cancel', 'canceled', 'expired')),
  current_period_end timestamptz,
  provider_event_at timestamptz not null,
  status_priority integer not null,
  event_id text not null,
  -- The payment the monthly grants of an annual plan belong to, so a refund can take them back.
  current_transaction_id text,
  grant_anchor timestamptz,
  grants_in_period integer not null default 0 check (grants_in_period >= 0)
);
create index creem_subscriptions_user_idx on public.creem_subscriptions (user_id);
create index creem_subscriptions_annual_due_idx on public.creem_subscriptions (grant_anchor) where interval = 'year';

create table public.creem_transactions (
  transaction_id text primary key,
  order_id text,
  customer_id text not null,
  user_id uuid references public.profiles(id) on delete set null,
  product_id text not null,
  subscription_id text,
  -- What the buyer paid, tax included: that is what `refund_amount` is measured against.
  amount bigint not null default 0 check (amount >= 0),
  currency text,
  granted_credits integer not null default 0 check (granted_credits >= 0),
  clawed_credits integer not null default 0 check (clawed_credits >= 0),
  refunded_amount bigint not null default 0 check (refunded_amount >= 0),
  paid_at timestamptz not null
);
create index creem_transactions_user_idx on public.creem_transactions (user_id);

create table public.creem_webhook_receipts (
  event_id text primary key,
  event_type text not null,
  occurred_at timestamptz not null,
  user_id uuid references public.profiles(id) on delete set null,
  result jsonb not null,
  received_at timestamptz not null default now()
);

alter table public.creem_customers enable row level security;
alter table public.creem_subscriptions enable row level security;
alter table public.creem_transactions enable row level security;
alter table public.creem_webhook_receipts enable row level security;
revoke all on public.creem_customers, public.creem_subscriptions, public.creem_transactions, public.creem_webhook_receipts from anon, authenticated;
grant select, insert, update, delete on public.creem_customers, public.creem_subscriptions, public.creem_transactions, public.creem_webhook_receipts to service_role;

-- The one place that decides `profiles.plan`, across both providers. Polar's `canceled` means "until the period ends"
-- and only `revoked` ends it; Creem's `canceled` is terminal, so Creem lists what still entitles.
create function public.recompute_plan(p_user uuid) returns text
language plpgsql security definer set search_path to 'public' as $$
declare v_plan text;
begin
  select plan into v_plan from (
    select s.plan from public.polar_subscriptions s where s.user_id = p_user and s.status <> 'revoked'
    union all
    select s.plan from public.creem_subscriptions s
     where s.user_id = p_user and s.status in ('active', 'trialing', 'scheduled_cancel', 'past_due')
  ) held
  order by case plan when 'creator' then 2 else 1 end desc limit 1;
  update public.profiles set plan = coalesce(v_plan, 'free') where id = p_user;
  return coalesce(v_plan, 'free');
end;
$$;
revoke all on function public.recompute_plan(uuid) from public, anon, authenticated;
grant execute on function public.recompute_plan(uuid) to service_role;

create or replace function public.account_is_paid(p_user uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select
    exists (
      select 1 from public.profiles p
      where p.id = p_user and (p.retention_exempt or p.plan <> 'free')
    )
    or exists (
      select 1 from public.polar_purchases o
      where o.user_id = p_user and o.paid_at is not null
        and o.total_amount > 0 and o.refunded_amount < o.total_amount
    )
    or exists (
      select 1 from public.polar_subscriptions s
      where s.user_id = p_user and s.status in ('active', 'past_due')
    )
    or exists (
      select 1 from public.creem_transactions t
      where t.user_id = p_user and t.amount > 0 and t.refunded_amount < t.amount
    )
    or exists (
      select 1 from public.creem_subscriptions s
      where s.user_id = p_user and s.status in ('active', 'trialing', 'scheduled_cancel', 'past_due')
    );
$$;

create function public.process_creem_event(p_event_id text, p_event_type text, p_event_at timestamptz, p_object jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $_$
declare
 -- A customer is an object on checkouts and subscriptions, a bare id inside a transaction.
 v_customer text := coalesce(
   nullif(p_object#>>'{customer,id}',''),
   case when jsonb_typeof(p_object->'customer')='string' then nullif(p_object->>'customer','') end,
   nullif(p_object#>>'{transaction,customer}','')
 );
 v_email text := nullif(p_object#>>'{customer,email}','');
 -- Set by our checkout route. It decides the account: the email is what the buyer typed on Creem's page.
 v_external text := coalesce(
   nullif(p_object#>>'{metadata,user_id}',''),
   nullif(p_object#>>'{customer,metadata,user_id}',''),
   nullif(p_object#>>'{checkout,metadata,user_id}','')
 );
 v_external_user uuid; v_user uuid; v_link text; v_result jsonb; v_rows integer;
 v_product text := nullif(p_object#>>'{product,id}',''); v_stored_product text;
 v_catalog public.billing_catalog%rowtype;
 v_tran public.creem_transactions%rowtype;
 v_tran_id text; v_order_id text; v_amount bigint; v_currency text;
 v_sub_id text; v_status text; v_priority integer; v_plan text; v_interval text;
 v_granted integer := 0; v_clawed integer := 0;
 v_refund bigint; v_target integer; v_balance integer; v_key text;
begin
 if coalesce(p_event_id,'')='' or p_event_at is null or jsonb_typeof(p_object) is distinct from 'object' then
  raise exception 'Invalid billing event.' using errcode='22023';
 end if;
 if p_event_type not in ('checkout.completed','subscription.paid','subscription.active','subscription.trialing',
   'subscription.update','subscription.past_due','subscription.unpaid','subscription.paused',
   'subscription.scheduled_cancel','subscription.canceled','subscription.expired','refund.created','dispute.created') then
  return jsonb_build_object('ok',true,'ignored',p_event_type);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('creem:event:'||p_event_id,0));
 select result into v_result from public.creem_webhook_receipts where event_id=p_event_id;
 if found then return v_result || jsonb_build_object('duplicate',true,'credits',0); end if;

 if p_event_type in ('refund.created','dispute.created') then
  v_tran_id := nullif(p_object#>>'{transaction,id}','');
  if v_tran_id is null then raise exception 'Invalid billing event.' using errcode='22023'; end if;
  select user_id,customer_id into v_user,v_customer from public.creem_transactions where transaction_id=v_tran_id;
  -- Raising answers 5xx, so Creem delivers it again: the payment's own event may simply not have arrived yet.
  if not found then raise exception 'Unknown billing transaction.' using errcode='22023'; end if;
  if v_user is null then return jsonb_build_object('ok',true,'skipped','account no longer exists'); end if;
  perform pg_advisory_xact_lock(hashtextextended('creem:customer:'||v_customer,0));
  select credit_balance into v_balance from public.profiles where id=v_user for update;
  if not found then return jsonb_build_object('ok',true,'skipped','account no longer exists'); end if;
  select * into v_tran from public.creem_transactions where transaction_id=v_tran_id for update;
  if p_event_type='refund.created' then
   v_refund := (p_object->>'refund_amount')::bigint;
   if v_refund is null or v_refund<0 then raise exception 'Invalid refund amount.' using errcode='22023'; end if;
   v_refund := least(v_tran.amount, v_tran.refunded_amount+v_refund);
   v_key := 'creem:refund:'||coalesce(nullif(p_object->>'id',''),p_event_id);
  else
   v_refund := v_tran.amount;
   v_key := 'creem:dispute:'||v_tran_id;
   raise warning 'creem: dispute on transaction % for user %', v_tran_id, v_user;
  end if;
  v_target := case when v_tran.amount>0 then (v_tran.granted_credits::numeric*v_refund/v_tran.amount)::integer else v_tran.granted_credits end;
  -- The balance never goes negative: spent credits stay spent, and Creem has already taken the money back.
  v_clawed := least(greatest(v_target-v_tran.clawed_credits,0), greatest(coalesce(v_balance,0),0));
  if v_clawed>0 then
   insert into public.credit_ledger(user_id,delta,reason,external_id)
   values(v_user,-v_clawed,case when p_event_type='refund.created' then 'Refund' else 'Payment dispute' end,v_key)
   on conflict(external_id) where external_id is not null do nothing;
   get diagnostics v_rows=row_count;
   if v_rows=0 then v_clawed:=0; end if;
  end if;
  update public.creem_transactions set refunded_amount=v_refund,clawed_credits=clawed_credits+v_clawed where transaction_id=v_tran_id;
  v_result := jsonb_build_object('ok',true,'credits',-v_clawed);
  insert into public.creem_webhook_receipts(event_id,event_type,occurred_at,user_id,result) values(p_event_id,p_event_type,p_event_at,v_user,v_result);
  return v_result;
 end if;

 if v_customer is null then raise exception 'Invalid billing event.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('creem:customer:'||v_customer,0));
 select user_id into v_user from public.creem_customers where customer_id=v_customer;
 if found then
  if v_user is null then return jsonb_build_object('ok',true,'skipped','account no longer exists'); end if;
  perform 1 from public.profiles where id=v_user for update;
  if not found then return jsonb_build_object('ok',true,'skipped','account no longer exists'); end if;
 else
  -- The regex guards the cast: a stray value would throw 22P02, which is a 5xx and a retry that can never succeed.
  if v_external ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
   select id,creem_customer_id into v_external_user,v_link from public.profiles where id=v_external::uuid for update;
   if found then v_user := v_external_user; end if;
  end if;
  if v_user is null then
   if v_email is null then return jsonb_build_object('ok',true,'skipped','no email on event'); end if;
   if (select count(*) from public.profiles where lower(email)=lower(v_email))<>1 then
    return jsonb_build_object('ok',true,'skipped','no matching account');
   end if;
   select id,creem_customer_id into v_user,v_link from public.profiles where lower(email)=lower(v_email) for update;
  end if;
  if v_link is not null and v_link<>v_customer then
   -- Matched by email, a second customer proves nothing. Matched by the id our checkout set, the payment is the
   -- account's: credit it, keep the first link, and map this customer so its later events find the account.
   if v_external_user is null then return jsonb_build_object('ok',true,'skipped','account already linked'); end if;
   raise warning 'creem: user % pays from customer %, account is linked to %', v_user, v_customer, v_link;
  else
   update public.profiles set creem_customer_id=v_customer where id=v_user;
  end if;
  insert into public.creem_customers(customer_id,user_id) values(v_customer,v_user) on conflict (customer_id) do nothing;
 end if;

 if v_product is not null then
  select * into v_catalog from public.billing_catalog where creem_product_id=v_product;
 end if;
 -- Money came in for a product we cannot map: 5xx, so Creem retries once the row exists.
 if v_catalog.creem_product_id is null and p_event_type in ('checkout.completed','subscription.paid') then
  raise exception 'Unknown billing product.' using errcode='22023';
 end if;

 if p_event_type='checkout.completed' then
  -- A subscription's first checkout only links the customer: `subscription.paid` grants, so credits come once.
  if v_catalog.kind='pack' then
   v_order_id := nullif(p_object#>>'{order,id}','');
   v_tran_id := nullif(p_object#>>'{order,transaction}','');
   if v_order_id is null or v_tran_id is null then raise exception 'Invalid billing event.' using errcode='22023'; end if;
   if exists(select 1 from public.creem_transactions where transaction_id=v_tran_id and user_id is distinct from v_user) then
    raise exception 'Purchase belongs to another account.' using errcode='22023';
   end if;
   v_amount := coalesce((p_object#>>'{order,amount_paid}')::bigint,(p_object#>>'{order,amount}')::bigint,0);
   insert into public.creem_transactions(transaction_id,order_id,customer_id,user_id,product_id,amount,currency,paid_at)
   values(v_tran_id,v_order_id,v_customer,v_user,v_product,v_amount,p_object#>>'{order,currency}',p_event_at)
   on conflict(transaction_id) do nothing;
   insert into public.credit_ledger(user_id,delta,reason,external_id)
   values(v_user,v_catalog.credits,'Credit pack purchase','creem:order:'||v_order_id)
   on conflict(external_id) where external_id is not null do nothing;
   get diagnostics v_rows=row_count;
   if v_rows=1 then
    v_granted := v_catalog.credits;
    update public.creem_transactions set granted_credits=granted_credits+v_granted where transaction_id=v_tran_id;
   end if;
  end if;
 else
  v_sub_id := nullif(p_object->>'id','');
  v_status := coalesce(nullif(p_object->>'status',''),substr(p_event_type,length('subscription.')+1));
  if v_sub_id is null then raise exception 'Invalid billing event.' using errcode='22023'; end if;
  if v_status not in ('active','trialing','paused','past_due','unpaid','scheduled_cancel','canceled','expired') then
   v_result := jsonb_build_object('ok',true,'skipped','unknown subscription status');
   insert into public.creem_webhook_receipts(event_id,event_type,occurred_at,user_id,result) values(p_event_id,p_event_type,p_event_at,v_user,v_result);
   return v_result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('creem:subscription:'||v_sub_id,0));
  if exists(select 1 from public.creem_subscriptions where subscription_id=v_sub_id and (customer_id<>v_customer or user_id is distinct from v_user)) then
   raise exception 'Subscription belongs to another account.' using errcode='22023';
  end if;
  -- `into` clears its targets when no row is found, so the stored product goes through its own variable.
  select plan,interval,product_id into v_plan,v_interval,v_stored_product from public.creem_subscriptions where subscription_id=v_sub_id;
  v_product := coalesce(v_product,v_stored_product);
  if v_catalog.kind='plan' then v_plan:=v_catalog.plan_id; v_interval:=v_catalog.interval; end if;
  -- A retired or foreign product with no stored subscription has no entitlement to change.
  if v_plan is null or v_product is null then return jsonb_build_object('ok',true,'skipped','unmapped subscription product'); end if;
  v_priority := case v_status when 'active' then 0 when 'trialing' then 0 when 'scheduled_cancel' then 1 when 'past_due' then 1
    when 'unpaid' then 2 when 'paused' then 2 else 3 end;
  insert into public.creem_subscriptions(subscription_id,customer_id,user_id,product_id,plan,interval,status,current_period_end,provider_event_at,status_priority,event_id)
  values(v_sub_id,v_customer,v_user,v_product,v_plan,v_interval,v_status,(p_object->>'current_period_end_date')::timestamptz,p_event_at,v_priority,p_event_id)
  on conflict(subscription_id) do update set product_id=excluded.product_id,plan=excluded.plan,interval=excluded.interval,status=excluded.status,
   current_period_end=coalesce(excluded.current_period_end,creem_subscriptions.current_period_end),
   provider_event_at=excluded.provider_event_at,status_priority=excluded.status_priority,event_id=excluded.event_id
  where (excluded.provider_event_at,excluded.status_priority)>(creem_subscriptions.provider_event_at,creem_subscriptions.status_priority);

  if p_event_type='subscription.paid' then
   if v_catalog.kind is distinct from 'plan' then raise exception 'Invalid paid product.' using errcode='22023'; end if;
   v_tran_id := coalesce(nullif(p_object->>'last_transaction_id',''),nullif(p_object#>>'{last_transaction,id}',''));
   if v_tran_id is null then raise exception 'Invalid billing event.' using errcode='22023'; end if;
   if exists(select 1 from public.creem_transactions where transaction_id=v_tran_id and user_id is distinct from v_user) then
    raise exception 'Purchase belongs to another account.' using errcode='22023';
   end if;
   v_amount := coalesce((p_object#>>'{last_transaction,amount_paid}')::bigint,(p_object#>>'{last_transaction,amount}')::bigint,0);
   v_currency := p_object#>>'{last_transaction,currency}';
   v_order_id := nullif(p_object#>>'{last_transaction,order}','');
   insert into public.creem_transactions(transaction_id,order_id,customer_id,user_id,product_id,subscription_id,amount,currency,paid_at)
   values(v_tran_id,v_order_id,v_customer,v_user,v_product,v_sub_id,v_amount,v_currency,p_event_at)
   on conflict(transaction_id) do nothing;
   insert into public.credit_ledger(user_id,delta,reason,external_id)
   values(v_user,v_catalog.credits,'Plan payment','creem:tran:'||v_tran_id)
   on conflict(external_id) where external_id is not null do nothing;
   get diagnostics v_rows=row_count;
   if v_rows=1 then
    v_granted := v_catalog.credits;
    update public.creem_transactions set granted_credits=granted_credits+v_granted where transaction_id=v_tran_id;
    update public.creem_subscriptions set current_transaction_id=v_tran_id,grant_anchor=p_event_at,grants_in_period=1 where subscription_id=v_sub_id;
   end if;
  end if;
  perform public.recompute_plan(v_user);
 end if;

 v_result := jsonb_build_object('ok',true,'credits',v_granted);
 insert into public.creem_webhook_receipts(event_id,event_type,occurred_at,user_id,result) values(p_event_id,p_event_type,p_event_at,v_user,v_result);
 return v_result;
end;
$_$;
revoke all on function public.process_creem_event(text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.process_creem_event(text,text,timestamptz,jsonb) to service_role;

-- An annual plan pays once and `subscription.paid` fires once a year, so the other eleven months of credits come from
-- here. The daily cleanup cron calls it; a missed day catches up, and the key per month makes a rerun a no-op.
create function public.grant_annual_credits(p_now timestamptz default now(), p_limit integer default 1000) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
 r record; v_tran public.creem_transactions%rowtype; v_monthly integer; v_credits integer; v_rows integer;
 v_due timestamptz; v_total integer := 0;
begin
 for r in
  select s.subscription_id,s.customer_id,s.user_id,s.product_id from public.creem_subscriptions s
  where s.interval='year' and s.user_id is not null and s.grant_anchor is not null
    and s.status in ('active','trialing','scheduled_cancel') and s.grants_in_period<12
    and s.grant_anchor + s.grants_in_period * interval '1 month' <= p_now
  order by s.grant_anchor limit p_limit
 loop
  -- The same lock order as `process_creem_event`, so a webhook and this job cannot deadlock.
  perform pg_advisory_xact_lock(hashtextextended('creem:customer:'||r.customer_id,0));
  perform 1 from public.profiles where id=r.user_id for update;
  perform pg_advisory_xact_lock(hashtextextended('creem:subscription:'||r.subscription_id,0));
  select credits into v_monthly from public.billing_catalog where creem_product_id=r.product_id;
  if v_monthly is null then continue; end if;
  loop
   v_due := null;
   select s.grant_anchor + s.grants_in_period * interval '1 month' into v_due from public.creem_subscriptions s
    where s.subscription_id=r.subscription_id and s.status in ('active','trialing','scheduled_cancel') and s.grants_in_period<12
      and s.grant_anchor + s.grants_in_period * interval '1 month' <= p_now
      and (s.current_period_end is null or s.grant_anchor + s.grants_in_period * interval '1 month' < s.current_period_end);
   exit when v_due is null;
   select t.* into v_tran from public.creem_transactions t join public.creem_subscriptions s on s.current_transaction_id=t.transaction_id
    where s.subscription_id=r.subscription_id for update of t;
   exit when v_tran.transaction_id is null;
   -- Fully refunded or disputed: nothing more is owed. Partly refunded: the rest of the year shrinks with the money.
   exit when v_tran.amount>0 and v_tran.refunded_amount>=v_tran.amount;
   v_credits := case when v_tran.amount>0 then (v_monthly::numeric*(v_tran.amount-v_tran.refunded_amount)/v_tran.amount)::integer else v_monthly end;
   insert into public.credit_ledger(user_id,delta,reason,external_id)
   select r.user_id,v_credits,'Annual plan monthly credits','creem:'||r.subscription_id||':'||to_char(v_due,'YYYY-MM')
   where v_credits>0
   on conflict(external_id) where external_id is not null do nothing;
   get diagnostics v_rows=row_count;
   if v_rows=1 then
    update public.creem_transactions set granted_credits=granted_credits+v_credits where transaction_id=v_tran.transaction_id;
    v_total := v_total+v_credits;
   end if;
   update public.creem_subscriptions set grants_in_period=grants_in_period+1 where subscription_id=r.subscription_id;
  end loop;
 end loop;
 return v_total;
end;
$$;
revoke all on function public.grant_annual_credits(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.grant_annual_credits(timestamptz,integer) to service_role;

-- Only the plan computation changes: it now reads both providers.
create or replace function public.process_polar_event(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_data jsonb, p_purchase_plan text, p_credits integer, p_entitlement_plan text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
 v_customer text := coalesce(nullif(p_data->>'customer_id',''),nullif(p_data#>>'{customer,id}',''));
 v_email text := coalesce(p_data#>>'{customer,email}',p_data#>>'{user,email}',p_data->>'customer_email');
 -- `customer_external_id` is `profiles.id`, set by our checkout link, so it is a sure match. The email is only a
 -- fallback for purchases that did not come through that link.
 v_external text := coalesce(
   nullif(p_data#>>'{customer,external_id}',''),
   nullif(p_data->>'customer_external_id',''),
   nullif(p_data#>>'{customer,metadata,user_id}','')
 );
 v_external_user uuid;
 v_id text := nullif(p_data->>'id','');
 v_user uuid; v_link text; v_result jsonb; v_purchase public.polar_purchases%rowtype;
 v_sub jsonb; v_sub_id text; v_status text; v_version timestamptz; v_priority integer;
 v_granted integer := 0; v_rows integer; v_plan text;
begin
 if v_customer is null and nullif(v_email,'') is null and v_external is null then
  return jsonb_build_object('ok',true,'skipped','no email on event');
 end if;
 if p_event_id is null or p_event_id='' or p_event_at is null or v_id is null or v_customer is null then
  raise exception 'Invalid billing event.' using errcode='22023';
 end if;
 if p_event_type not in ('order.paid','order.refunded','subscription.active','subscription.canceled','subscription.revoked','subscription.past_due') then
  return jsonb_build_object('ok',true,'ignored',p_event_type);
 end if;
 if nullif(p_data#>>'{customer,id}','') is not null and p_data#>>'{customer,id}'<>v_customer then
  raise exception 'Conflicting billing customer.' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('polar:event:'||p_event_id,0));
 select result into v_result from public.polar_webhook_receipts where event_id=p_event_id;
 if found then return v_result || jsonb_build_object('duplicate',true,'credits',0); end if;
 perform pg_advisory_xact_lock(hashtextextended('polar:customer:'||v_customer,0));
 select user_id into v_user from public.polar_customers where customer_id=v_customer;
 if found then
  if v_user is null then return jsonb_build_object('ok',true,'skipped','account no longer exists'); end if;
  perform 1 from public.profiles where id=v_user for update;
  if not found then return jsonb_build_object('ok',true,'skipped','account no longer exists'); end if;
 else
  -- Match by external id FIRST. The email is whatever the buyer typed on Polar's page: a different one means money
  -- in and credits never granted, and the route answers 200 so Polar never resends.
  --
  -- The regex guards the cast: a non-uuid external id would throw 22P02, a 500 Polar retries forever.
  if v_external is not null
     and v_external ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then
   select id,polar_customer_id into v_external_user,v_link
   from public.profiles where id=v_external::uuid for update;
   if found then v_user := v_external_user; end if;
  end if;

  if v_user is null then
   if nullif(v_email,'') is null then return jsonb_build_object('ok',true,'skipped','no email on event'); end if;
   if (select count(*) from public.profiles where lower(email)=lower(v_email))<>1 then
    return jsonb_build_object('ok',true,'skipped','no matching account');
   end if;
   select id,polar_customer_id into v_user,v_link from public.profiles where lower(email)=lower(v_email) for update;
  end if;

  if v_link is not null and v_link<>v_customer then
   -- A second Polar customer for the same account. Matched by email it proves nothing: skip. Matched by
   -- the external id our checkout link set, the payment is the account's: credit it, keep the first link.
   if v_external_user is null then return jsonb_build_object('ok',true,'skipped','account already linked'); end if;
   raise warning 'polar: order % for user % comes from customer %, account is linked to %', v_id, v_user, v_customer, v_link;
   -- Map the second customer too: its later events (a refund, a cancelled subscription) may carry no
   -- external id, and the email path would skip them as "account already linked".
   insert into public.polar_customers(customer_id,user_id) values(v_customer,v_user) on conflict (customer_id) do nothing;
  else
   update public.profiles set polar_customer_id=v_customer where id=v_user;
   insert into public.polar_customers(customer_id,user_id) values(v_customer,v_user);
  end if;
 end if;
 if p_event_type in ('order.paid','order.refunded') then
  insert into public.polar_purchases(order_id,customer_id,user_id,product_id,total_amount,currency)
  values(v_id,v_customer,v_user,p_data->>'product_id',coalesce((p_data->>'total_amount')::bigint,0),p_data->>'currency') on conflict(order_id) do nothing;
  select * into v_purchase from public.polar_purchases where order_id=v_id for update;
  if v_purchase.customer_id<>v_customer or v_purchase.user_id is distinct from v_user then
   raise exception 'Purchase belongs to another account.' using errcode='22023';
  end if;
  if p_event_type='order.paid' then
   if p_purchase_plan is null or p_purchase_plan not in ('starter','creator') or p_credits is null or p_credits<=0 then
    raise exception 'Invalid paid product.' using errcode='22023';
   end if;
   if not v_purchase.granted then
    if exists(select 1 from public.credit_ledger where external_id='polar:'||v_id and user_id is distinct from v_user) then
     raise exception 'Purchase belongs to another account.' using errcode='22023';
    end if;
    insert into public.credit_ledger(user_id,delta,reason,external_id) values(v_user,p_credits,p_purchase_plan||' plan purchase','polar:'||v_id)
    on conflict(external_id) where external_id is not null do nothing;
    get diagnostics v_rows=row_count;
    if v_rows=1 then v_granted:=p_credits; end if;
    update public.polar_purchases set granted=true,credits=p_credits,plan=p_purchase_plan,paid_at=p_event_at where order_id=v_id;
   end if;
   v_sub:=p_data->'subscription'; v_sub_id:=nullif(v_sub->>'id',''); v_status:=v_sub->>'status';
   v_version:=coalesce((v_sub->>'modified_at')::timestamptz,(v_sub->>'created_at')::timestamptz,p_event_at);
  else
   if coalesce((p_data->>'refunded_amount')::bigint,0)<0 or coalesce((p_data->>'refunded_tax_amount')::bigint,0)<0 then
    raise exception 'Invalid refund amount.' using errcode='22023';
   end if;
   update public.polar_purchases set
    refunded_amount=greatest(refunded_amount,coalesce((p_data->>'refunded_amount')::bigint,0)),
    refunded_tax_amount=greatest(refunded_tax_amount,coalesce((p_data->>'refunded_tax_amount')::bigint,0)),
    refunded_at=greatest(refunded_at,p_event_at) where order_id=v_id;
  end if;
 else
  v_sub:=p_data; v_sub_id:=v_id; v_status:=substr(p_event_type,length('subscription.')+1);
  v_version:=coalesce((p_data->>'modified_at')::timestamptz,p_event_at);
 end if;
 if v_sub_id is not null and v_status in ('active','past_due','canceled','revoked')
  and (p_event_type<>'order.paid' or p_entitlement_plan is not null) then
  v_priority:=case v_status when 'active' then 0 when 'past_due' then 1 when 'canceled' then 2 else 3 end;
  perform pg_advisory_xact_lock(hashtextextended('polar:subscription:'||v_sub_id,0));
  if exists(select 1 from public.polar_subscriptions where subscription_id=v_sub_id and (customer_id<>v_customer or user_id is distinct from v_user)) then
   raise exception 'Subscription belongs to another account.' using errcode='22023';
  end if;
  select plan into v_plan from public.polar_subscriptions where subscription_id=v_sub_id;
  v_plan:=coalesce(p_entitlement_plan,v_plan);
  -- A retired product with no stored subscription has no entitlement to change.
  -- This branch is unreachable for paid orders because their plan is validated above.
  if v_plan is null then return jsonb_build_object('ok',true,'skipped','unmapped subscription product'); end if;
  if v_plan not in ('starter','creator') then raise exception 'Invalid subscription product.' using errcode='22023'; end if;
  insert into public.polar_subscriptions(subscription_id,customer_id,user_id,plan,status,current_period_end,provider_updated_at,status_priority,event_id)
  values(v_sub_id,v_customer,v_user,v_plan,v_status,(v_sub->>'current_period_end')::timestamptz,v_version,v_priority,p_event_id)
  on conflict(subscription_id) do update set plan=excluded.plan,status=excluded.status,
   current_period_end=coalesce(excluded.current_period_end,polar_subscriptions.current_period_end),
   provider_updated_at=excluded.provider_updated_at,status_priority=excluded.status_priority,event_id=excluded.event_id
  where (excluded.provider_updated_at,excluded.status_priority)>(polar_subscriptions.provider_updated_at,polar_subscriptions.status_priority)
   and polar_subscriptions.customer_id=excluded.customer_id and polar_subscriptions.user_id=excluded.user_id;
  perform public.recompute_plan(v_user);
 end if;
 v_result:=jsonb_build_object('ok',true,'credits',v_granted);
 insert into public.polar_webhook_receipts(event_id,event_type,occurred_at,user_id,result) values(p_event_id,p_event_type,p_event_at,v_user,v_result);
 return v_result;
end;
$_$;

create or replace function public.purge_stale_rate_limits() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_rows int;
begin
  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics v_rows = row_count;
  delete from public.upload_reservations
   where status = 'reserved' and expires_at < now() - interval '1 day';
  delete from public.polar_webhook_receipts where received_at < now() - interval '90 days';
  delete from public.creem_webhook_receipts where received_at < now() - interval '90 days';
  return v_rows;
end;
$$;
