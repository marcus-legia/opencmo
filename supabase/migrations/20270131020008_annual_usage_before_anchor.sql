-- Review of #238, finding 8: right after "Switch to annual", the subscription row is a year long before Creem's paid
-- event sets `grant_anchor`. `plan_usage_for` then took the period end (a year out) and counted from one month before
-- it, eleven months in the future: usage read 0, the pause lifted and the reset date showed next year. A yearly row
-- without an anchor now counts the month that ends on the next monthly step back from its period end.
create or replace function public.plan_usage_for(p_user uuid)
returns table (plan text, "interval" text, used integer, allowance integer, percent integer, resets_at timestamptz, paused boolean)
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_plan text;
  v_sub public.creem_subscriptions;
  v_allowance integer;
  v_start timestamptz;
  v_reset timestamptz;
  v_months integer;
  v_used integer;
begin
  select p.plan into v_plan from public.profiles p where p.id = p_user;
  if v_plan is null or v_plan not in ('starter', 'creator') then
    -- A free account's runs are its free ones (they cost 0): nothing to measure, nothing to pause.
    return query select 'free'::text, null::text, 0, 0, 0, null::timestamptz, false;
    return;
  end if;

  -- The subscription `recompute_plan` would pick: the best plan still in force.
  select s.* into v_sub from public.creem_subscriptions s
  where s.user_id = p_user and s.status in ('active', 'trialing', 'scheduled_cancel', 'past_due')
  order by case s.plan when 'creator' then 2 else 1 end desc, s.status_priority, s.provider_event_at desc
  limit 1;

  if v_sub.subscription_id is not null then
    select c.credits into v_allowance from public.billing_catalog c where c.creem_product_id = v_sub.product_id;
  end if;
  if v_allowance is null then
    -- No subscription row (a plan set by hand) or a product no longer listed: the plan's monthly row on sale.
    select c.credits into v_allowance from public.billing_catalog c
    where c.kind = 'plan' and c.plan_id = v_plan and c.on_sale
    order by (c."interval" = 'month') desc, c.sort limit 1;
  end if;

  if v_sub."interval" = 'year' and v_sub.grant_anchor is not null then
    -- Whole months since the year was paid: the current month of the year starts there.
    v_months := (extract(year from age(now(), v_sub.grant_anchor)) * 12 + extract(month from age(now(), v_sub.grant_anchor)))::integer;
    v_start := v_sub.grant_anchor + make_interval(months => greatest(v_months, 0));
    v_reset := v_start + interval '1 month';
  elsif v_sub."interval" = 'year' and v_sub.current_period_end is not null and v_sub.current_period_end > now() then
    -- A year not anchored yet: step back from its end, a month at a time, to the month running now.
    v_reset := v_sub.current_period_end;
    while v_reset - interval '1 month' > now() loop
      v_reset := v_reset - interval '1 month';
    end loop;
    v_start := v_reset - interval '1 month';
  elsif v_sub.current_period_end is not null and v_sub.current_period_end > now() then
    v_reset := v_sub.current_period_end;
    v_start := v_reset - interval '1 month';
  else
    v_start := date_trunc('month', now());
    v_reset := v_start + interval '1 month';
  end if;

  -- A credit pack paid this period raises this period's allowance (owner, 2026-11-19): buying one lifts the pause.
  -- Its credits net of any refund or dispute; a pack bought last month does not carry over.
  v_allowance := coalesce(v_allowance, 0) + coalesce((
    select sum(greatest(t.granted_credits - t.clawed_credits, 0))::integer
    from public.creem_transactions t
    join public.billing_catalog c on c.creem_product_id = t.product_id and c.kind = 'pack'
    where t.user_id = p_user and t.paid_at >= v_start), 0);

  -- Debits of work only (`ref_kind` set); grants, packs and claw-backs carry no ref and are not usage.
  select greatest(coalesce(-sum(l.delta), 0), 0)::integer into v_used
  from public.credit_ledger l
  where l.user_id = p_user and l.ref_kind is not null and l.created_at >= v_start;

  v_allowance := coalesce(v_allowance, 0);
  return query select
    'pro'::text,
    coalesce(v_sub."interval", 'month'),
    v_used,
    v_allowance,
    case when v_allowance > 0 then least(100, (v_used * 100) / v_allowance) else 0 end,
    v_reset,
    v_allowance > 0 and v_used >= v_allowance;
end;
$$;

revoke all on function public.plan_usage_for(uuid) from public, anon, authenticated;
grant execute on function public.plan_usage_for(uuid) to service_role;
