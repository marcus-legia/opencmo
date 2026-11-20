-- Wave 4b review of #242: the quote card route gets its own rate-limit bucket. Adds a bucket only; pushed before the
-- code that uses it.
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
      -- Wave 4b: quote card previews and saves (one GET per quote picked); their own bucket, so looking through
      -- quotes never uses up the approvals' `presets`.
      or (p_bucket = 'quote-cards' and p_limit = 300 and p_window_seconds = 3600)
      -- Creem checkout and portal links: each call reaches Creem.
      or (p_bucket = 'billing_checkout' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'billing_portal' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'uploads' and p_limit = 30 and p_window_seconds = 3600)
      -- A photo post's photos (20270120060000): up to 35 in one post, one reservation each.
      or (p_bucket = 'photo-uploads' and p_limit = 120 and p_window_seconds = 3600)
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
