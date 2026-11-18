-- Wave 2 A2 (docs/plans/cmo/2026-11-19-wave2-plan.md): one fair-use bar instead of prices.
--
-- `plan_usage()` tells a founder how much of this period's allowance they used: the credits debited by their work
-- (holds, settles and refunds of runs, jobs and orders) since the period started, against the plan's
-- `billing_catalog.credits`. An annual plan grants that amount every month (`grant_annual_credits`), so its period is
-- one month from the grant anchor, like a monthly plan's. Credits keep working underneath; this only reads them.
--
-- At 100% a paid account's new searches pause until the reset (Terms promise it): `cmo_enqueue` refuses `sales_scan`
-- and the research jobs. Drafts of work the founder already has keep running.

-- The founder's usage. Service role and the functions below only: a user reads their own through `plan_usage()`.
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
  elsif v_sub.current_period_end is not null and v_sub.current_period_end > now() then
    v_reset := v_sub.current_period_end;
    v_start := v_reset - interval '1 month';
  else
    v_start := date_trunc('month', now());
    v_reset := v_start + interval '1 month';
  end if;

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

create or replace function public.plan_usage()
returns table (plan text, "interval" text, used integer, allowance integer, percent integer, resets_at timestamptz, paused boolean)
  language sql stable security definer
  set search_path to ''
as $$
  select * from public.plan_usage_for(public.require_user());
$$;

revoke all on function public.plan_usage() from public, anon;
grant execute on function public.plan_usage() to authenticated, service_role;

-- The refusal at 100%, with the reset day in the founder's own time zone ("18 Dec").
create or replace function public.cmo_usage_paused_check(p_user uuid, p_kind text)
returns void
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_usage record;
  v_tz text;
begin
  if p_kind not in ('sales_scan', 'competitor_research', 'niche_video_research') then
    return;
  end if;
  select * into v_usage from public.plan_usage_for(p_user);
  if not coalesce(v_usage.paused, false) then
    return;
  end if;
  select p.timezone into v_tz from public.profiles p where p.id = p_user;
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = v_tz) then
    v_tz := 'UTC';
  end if;
  raise exception 'You used this month''s allowance. New scans start again on %.',
    to_char(v_usage.resets_at at time zone v_tz, 'FMDD Mon') using errcode = 'P0001';
end;
$$;

revoke all on function public.cmo_usage_paused_check(uuid, text) from public, anon, authenticated;
grant execute on function public.cmo_usage_paused_check(uuid, text) to service_role;

create or replace function public.cmo_enqueue(p_user uuid, p_kind text, p_input jsonb) returns public.cmo_runs
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_row public.cmo_runs;
  v_price integer := public.cmo_job_price(p_kind);
  v_key text := case when p_kind in ('post_draft', 'write_caption', 'write_video_brief', 'write_slides', 'publish_post')
    then coalesce(p_input->>'item_id', p_input->>'order_id') end;
begin
  if p_kind is null or p_kind = 'onboard' or public.cmo_job_daily_limit(p_kind) <= 0 then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 4096 then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  -- The founder's Claude inbox is gone (2026-11-14): `brain` once made a paid founder's run free, and `inbox` named
  -- the item a replay answered. Neither means anything now; an old client that still sends them pays as anyone does.
  p_input := p_input - 'brain' - 'inbox';
  if public.cmo_paused(p_user) then
    raise exception 'Your CMO is paused. Resume it to start new work.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':cmo_run', 1713));

  select * into v_row from public.cmo_runs
  where user_id = p_user and kind = p_kind and status in ('queued', 'running')
    -- A running run whose lease ran out is still in flight: claim_cmo_run puts it back in the queue. Treating it as
    -- gone made a second run and a second hold, and both ran (review R5).
    -- Without an item or order, only the same request is the same run: two posts with two briefs are two runs
    -- (review R4; the second brief used to be dropped while the chat said it had started).
    and (case when v_key is null then (input - 'brain' - 'inbox') = p_input
              else coalesce(input->>'item_id', input->>'order_id') = v_key end)
  order by created_at desc limit 1;
  if found then
    return v_row;
  end if;

  -- Read under the lock above, so two requests at once cannot both be the free one.
  if v_price > 0 and public.cmo_first_run_free(p_user, p_kind) then
    v_price := 0;
  elsif v_price > 0 and not public.cmo_paid(p_user) then
    perform public.cmo_plan_required();
  end if;

  -- The fair-use pause (wave 2): a used-up allowance stops new searches until the reset, not drafts of work in hand.
  if v_price > 0 then
    perform public.cmo_usage_paused_check(p_user, p_kind);
  end if;

  if (select count(*) from public.cmo_runs
      where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day') >= public.cmo_job_daily_limit(p_kind) then
    raise exception 'You have reached today''s limit for this task. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if v_price > 0 and public.credit_balance(p_user) < v_price then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_price, public.credit_balance(p_user) using errcode = 'P0001';
  end if;

  insert into public.cmo_runs (user_id, kind, status, input, credits)
  values (p_user, p_kind, 'queued', p_input, v_price) returning * into v_row;
  if v_price > 0 then
    perform public.credit_hold(p_user, 'cmo_run', v_row.id, v_price, 'CMO hold');
  end if;
  return v_row;
end;
$$;
