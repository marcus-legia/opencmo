-- The Composer (owner, 2026-11-25; plan docs/superpowers/plans/2026-11-25-composer.md, Part L).
--
-- 1. `subreddit_rules` keeps the full rules, the sub's posting guidance and an avoid/use guide, so the Composer can
--    show and check against every rule, not only the verdict and its 200-character summary.
-- 2. The founder's Reddit account as they type it (username, karma, account age): no API Ferreto uses can read a
--    Reddit profile, so karma and age come from the founder, once.
-- 3. `compose_check`: the AI check of a post the founder wrote, 1 credit, at most 30 a day.
-- 4. A `composer` rate-limit bucket (120 an hour) for the context route, and `composer-read` (30 a day) for the reads
--    it pays a provider for.

begin;

alter table public.subreddit_rules
  add column if not exists rules_text text,
  add column if not exists submit_text text,
  add column if not exists guide jsonb;
alter table public.subreddit_rules
  add constraint subreddit_rules_rules_text_check check (rules_text is null or char_length(rules_text) <= 6000),
  add constraint subreddit_rules_submit_text_check check (submit_text is null or char_length(submit_text) <= 2000),
  add constraint subreddit_rules_guide_check check (guide is null or jsonb_typeof(guide) = 'object');

alter table public.profiles
  add column if not exists reddit_username text,
  add column if not exists reddit_karma integer,
  add column if not exists reddit_created_at date;
alter table public.profiles
  add constraint profiles_reddit_username_check check (reddit_username is null or reddit_username ~ '^[A-Za-z0-9_-]{3,20}$'),
  add constraint profiles_reddit_karma_check check (reddit_karma is null or reddit_karma between 0 and 10000000),
  add constraint profiles_reddit_created_at_check check (reddit_created_at is null or reddit_created_at between date '2005-06-01' and current_date + 1);

-- The founder's own row only. "u/name" and "/u/name" are taken as "name"; an empty username clears all three.
create or replace function public.save_reddit_account(p_username text, p_karma integer default null, p_created date default null)
returns table (reddit_username text, reddit_karma integer, reddit_created_at date)
language plpgsql security definer
set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_name text := nullif(regexp_replace(btrim(coalesce(p_username, '')), '^/?u/', '', 'i'), '');
begin
  if v_name is not null and v_name !~ '^[A-Za-z0-9_-]{3,20}$' then
    raise exception 'Use your Reddit username, like my_handle.' using errcode = '22023';
  end if;
  if p_karma is not null and (p_karma < 0 or p_karma > 10000000) then
    raise exception 'Karma is a number from 0.' using errcode = '22023';
  end if;
  if p_created is not null and (p_created < date '2005-06-01' or p_created > current_date) then
    raise exception 'Use the month your Reddit account was made.' using errcode = '22023';
  end if;
  update public.profiles p set
    reddit_username = v_name,
    reddit_karma = case when v_name is null then null else p_karma end,
    reddit_created_at = case when v_name is null then null else date_trunc('month', p_created)::date end
  where p.id = v_user;
  return query select p.reddit_username, p.reddit_karma, p.reddit_created_at from public.profiles p where p.id = v_user;
end;
$$;
revoke all on function public.save_reddit_account(text, integer, date) from public, anon;
grant execute on function public.save_reddit_account(text, integer, date) to authenticated;

alter table public.cmo_runs drop constraint cmo_runs_kind_check;
alter table public.cmo_runs add constraint cmo_runs_kind_check check (kind = any (array['onboard', 'plan_week', 'post_draft',
  'sales_scan', 'competitor_research', 'pull_metrics', 'summarize_memory', 'review_week', 'write_caption', 'write_video_brief',
  'write_slides', 'publish_post', 'niche_video_research', 'distill_ratings', 'repurpose_post', 'photo_caption',
  'sales_reply_drafts', 'compose_check']));

create or replace function public.cmo_job_price(p_kind text) returns integer
language sql immutable
set search_path to ''
as $$
  select case p_kind when 'plan_week' then 1 when 'post_draft' then 1 when 'sales_scan' then 5
    when 'competitor_research' then 2 when 'pull_metrics' then 0 when 'summarize_memory' then 0 when 'review_week' then 0
    when 'write_caption' then 1 when 'write_video_brief' then 1 when 'publish_post' then 0 when 'niche_video_research' then 2
    when 'repurpose_post' then 1
    when 'photo_caption' then 1
    -- Included in the plan (wave 2); `cmo_enqueue` keeps it paid-only.
    when 'sales_reply_drafts' then 0
    -- The Composer's AI check (2026-11-25).
    when 'compose_check' then 1
    else 0 end
$$;

create or replace function public.cmo_job_daily_limit(p_kind text) returns integer
language sql immutable
set search_path to ''
as $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'publish_post' then 100
    -- cmo-review-3 2.2: one rating round a day (`cmo_rate_drafts`), with room for a retry.
    when 'distill_ratings' then 2
    when 'repurpose_post' then 20
    when 'sales_reply_drafts' then 5
    when 'compose_check' then 30
    else 0 end
$$;

-- The Composer's own rate-limit bucket.
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
      or (p_bucket = 'feedback-turn' and p_limit = 60 and p_window_seconds = 3600)
      -- The Composer's context (20270206010000): each call may read a sub's rules from Reddit.
      or (p_bucket = 'composer' and p_limit = 120 and p_window_seconds = 3600)
      -- Reads the Composer pays a provider for (a sub not in the week's cache, the founder's post search): a paid
      -- account only, 30 a day (security review 2026-11-25).
      or (p_bucket = 'composer-read' and p_limit = 30 and p_window_seconds = 86400);
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

commit;
