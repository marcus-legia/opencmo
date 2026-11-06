-- Polar is gone (owner, 2026-11-05): Creem is the only payment provider. Polar's API showed no subscription and no order
-- ever, so these tables hold nothing to keep.
--
-- If some row did exist, one thing would still go wrong silently: `account_is_paid` reads these tables, and an account it
-- no longer sees as paid is deleted 30 days after sign-up. So anyone they show as having paid is exempted first.
update public.profiles p set retention_exempt = true
where p.id in (
  select o.user_id from public.polar_purchases o
  where o.user_id is not null and o.paid_at is not null and o.total_amount > 0 and o.refunded_amount < o.total_amount
  union
  select s.user_id from public.polar_subscriptions s where s.user_id is not null and s.status in ('active', 'past_due')
);

create or replace function public.recompute_plan(p_user uuid) returns text
language plpgsql security definer set search_path to 'public' as $$
declare v_plan text;
begin
  select s.plan into v_plan from public.creem_subscriptions s
   where s.user_id = p_user and s.status in ('active', 'trialing', 'scheduled_cancel', 'past_due')
   order by case s.plan when 'creator' then 2 else 1 end desc limit 1;
  update public.profiles set plan = coalesce(v_plan, 'free') where id = p_user;
  return coalesce(v_plan, 'free');
end;
$$;

create or replace function public.account_is_paid(p_user uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select
    exists (
      select 1 from public.profiles p
      where p.id = p_user and (p.retention_exempt or p.plan <> 'free')
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
  delete from public.creem_webhook_receipts where received_at < now() - interval '90 days';
  return v_rows;
end;
$$;

create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_bucket text;
  v_plan text;
  v_quota record;
  v_expected int;
  v_window_start timestamptz;
  v_legacy_count int := 0;
  v_count int;
  v_allowed boolean := false;
begin
  v_bucket := case p_bucket
    when 'daily_preview' then 'preview'
    when 'daily_export' then 'export'
    else p_bucket
  end;

  if v_bucket in ('preview', 'export') then
    select coalesce(plan, 'free') into v_plan
    from public.profiles where id = v_user;
    select * into v_quota from public.plan_quota(v_plan);
    v_expected := case
      when v_bucket = 'preview' then v_quota.previews_per_day
      else v_quota.exports_per_day
    end;
    v_allowed := p_limit = v_expected and p_window_seconds = 86400;
    if p_bucket = 'preview' and p_limit = 2 and p_window_seconds = 60 then
      v_allowed := true;
    end if;
  else
    v_allowed := (p_bucket = 'presets' and p_limit = 60 and p_window_seconds = 3600)
      -- Creem checkout and portal links: each call reaches Creem.
      or (p_bucket = 'billing_checkout' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'billing_portal' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'uploads' and p_limit = 30 and p_window_seconds = 3600)
      or (p_bucket = 'jobs' and p_limit = 10 and p_window_seconds = 3600)
      or (p_bucket = 'retry' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'project-write' and p_limit = 60 and p_window_seconds = 3600)
      -- P4: connecting and disconnecting social accounts (each call reaches Zernio).
      or (p_bucket = 'accounts' and p_limit = 30 and p_window_seconds = 3600)
      -- P4: moving a slot on the calendar and "I posted it" (`/api/v1/schedule/slots/[id]`).
      or (p_bucket = 'schedule' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'editor-write' and p_limit = 240 and p_window_seconds = 60)
      or (p_bucket = 'media' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'scene_codes' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'feedback' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_preview' and p_limit = 60 and p_window_seconds = 3600)
      -- POST /api/v1/generations: each request can run a paid moderation call.
      or (p_bucket = 'generations' and p_limit = 120 and p_window_seconds = 3600)
      -- `create_generation` itself: a direct PostgREST call skips the route's bucket.
      or (p_bucket = 'generation_create' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_look' and p_limit = 60 and p_window_seconds = 3600)
      -- Review R4 (20270102020000): routes that had no limit of their own.
      or (p_bucket = 'agent-turn' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'agent-continue' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'agent-session' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'captures' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'cmo-runs' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'onboarding' and p_limit = 20 and p_window_seconds = 3600)
      -- The CMO chat's thumbs (20270103010000).
      or (p_bucket = 'feedback-turn' and p_limit = 60 and p_window_seconds = 3600);
  end if;

  if not v_allowed then
    raise exception 'Invalid rate limit.' using errcode = '22023';
  end if;

  -- The short preview/export window counts in its own row: in the first minute after UTC
  -- midnight the 60-second and the daily window share a `window_start`, and used to add up
  -- into the daily quota (CI red at 00:00:24 UTC on 04/10).
  if v_bucket in ('preview', 'export') and p_window_seconds <> 86400 then
    v_bucket := v_bucket || ':' || p_window_seconds;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  if v_bucket in ('preview', 'export') and p_window_seconds = 86400 then
    select coalesce(max(count), 0) into v_legacy_count
    from public.rate_limits
      where user_id = v_user
      and bucket = 'daily_' || v_bucket
      and window_start = v_window_start;
  end if;

  insert into public.rate_limits(user_id, bucket, window_start, count)
  values(v_user, v_bucket, v_window_start, v_legacy_count + 1)
  on conflict (user_id, bucket, window_start)
  do update set count = greatest(public.rate_limits.count, v_legacy_count) + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

drop function public.process_polar_event(text, text, timestamptz, jsonb, text, integer, text);
drop table public.polar_webhook_receipts, public.polar_subscriptions, public.polar_purchases, public.polar_customers;
alter table public.profiles drop column polar_customer_id;
