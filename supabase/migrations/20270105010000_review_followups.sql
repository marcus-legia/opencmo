-- 20270105010000: review follow-ups (docs/plans/cmo/2026-11-02-review-followups-plan.md). Each block names its item.

begin;

-- Q8: a domain with a path is a link, but not a code file name such as "Next.js/React" (the same rule as `hasLink`
-- in apps/web/lib/cmo/jobs/check-post.ts; the cases are packages/contracts/link-cases.json).
create or replace function public.caption_check(p_profile text, p_text text, p_title text) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
declare
  v_profile jsonb := public.platform_profile(p_profile);
  v_label text := v_profile->>'label';
  v_tags integer;
begin
  if v_profile is null or v_profile->>'kind' not in ('caption', 'youtube') then
    raise exception 'Captions are for Instagram, TikTok and YouTube.' using errcode = '22023';
  end if;
  if p_text is null or char_length(trim(p_text)) = 0 or char_length(p_text) > (v_profile->>'limit')::integer then
    raise exception 'A % is 1 to % characters.', v_label, to_char((v_profile->>'limit')::integer, 'FM999,999') using errcode = '22023';
  end if;
  if v_profile->>'kind' = 'youtube' then
    if p_title is null or char_length(trim(p_title)) = 0 or char_length(p_title) > (v_profile->>'title')::integer then
      raise exception 'A YouTube title is 1 to % characters.', v_profile->>'title' using errcode = '22023';
    end if;
  elsif p_title is not null then
    raise exception 'Only YouTube has a title.' using errcode = '22023';
  end if;
  if concat_ws(' ', p_title, p_text) ~* '(https?://|www\.|\m[a-z0-9][a-z0-9-]*\.(?!(jsx?|tsx?|mjs|py|rb|css|html?|md|json|ya?ml|txt|sql|vue|svelte)/)[a-z]{2,}/[^[:space:]])' then
    raise exception 'Captions carry no links.' using errcode = '22023';
  end if;
  -- `countHashtags` in lib/cmo/platforms.ts: `#word` with a letter in it, not `#1` or `a#b`.
  select count(*) into v_tags
  from regexp_matches(concat_ws(' ', p_title, p_text), '(^|[^[:alnum:]_&/])#[[:alnum:]_]*[[:alpha:]][[:alnum:]_]*', 'g');
  if v_tags > (v_profile->>'hashtags')::integer then
    raise exception 'A % carries at most % hashtags.', v_label, v_profile->>'hashtags' using errcode = '22023';
  end if;
end;
$$;

-- R2: allowlist entries nothing calls any more (the draft, mcp and zip buckets and the 30-an-hour MCP preview), and
-- consume_daily_task_quota, which nothing calls. The 2-a-minute preview stays for now: pgTAP 020 and 118 test the
-- short-window counting with it, and that code goes with it.
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

drop function if exists public.consume_daily_task_quota(text);

-- R3: 3D was removed on 2026-10-24; the limit is on explainer scenes (apps/web/lib/api/errors.ts maps it to 429).
create or replace function public.save_scene_code(p_code text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_hash text;
begin
  if p_code is null or btrim(p_code) = '' then
    raise exception 'Write the scene code first.' using errcode = '22023';
  end if;
  if char_length(p_code) > 32000 then
    raise exception 'The scene code is longer than 32000 characters.' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
  if not exists (select 1 from public.scene_codes where user_id = v_user and hash = v_hash) then
    if not public.rate_limit_hit('scene_codes', 300, 3600) then
      raise exception 'Too many explainer scenes in a short time. Try again later.' using errcode = 'P0001';
    end if;
    insert into public.scene_codes (user_id, hash, code) values (v_user, v_hash, p_code)
      on conflict do nothing;
  end if;
  return v_hash;
end;
$$;

commit;
