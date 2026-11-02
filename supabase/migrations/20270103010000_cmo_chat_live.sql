-- 20270103010000: CMO chat live (docs/plans/cmo/2026-11-02-cmo-chat-live-plan.md).
--
-- * cmo_runs joins the realtime publication: the chat hears that a run it started finished. RLS already limits a
--   founder to their own rows (select policy on cmo_runs), and realtime applies it.
-- * agent_turn_ratings keeps the thumbs on a CMO answer: one row per turn, written only through rate_agent_turn,
--   which checks that the session is the caller's own and that the turn exists.
-- * agent_open_cmo_session no longer reuses a conversation of 200 turns or more: the next message opens a new one,
--   and the old one stays in Past conversations.
-- * rate_limit_hit allows the 'feedback-turn' bucket (60 an hour) for the ratings route.

begin;

alter publication supabase_realtime add table public.cmo_runs;

create table public.agent_turn_ratings (
  session_id  uuid not null references public.agent_sessions(id) on delete cascade,
  turn_number integer not null check (turn_number >= 1),
  user_id     uuid not null references auth.users(id) on delete cascade,
  rating      text not null check (rating in ('up', 'down')),
  reason      text check (reason is null or char_length(reason) between 1 and 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (session_id, turn_number)
);
create index agent_turn_ratings_user_idx on public.agent_turn_ratings (user_id, created_at desc);

alter table public.agent_turn_ratings enable row level security;
create policy "read own turn ratings" on public.agent_turn_ratings
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.agent_turn_ratings from anon, authenticated;
grant select on public.agent_turn_ratings to authenticated;
grant all on public.agent_turn_ratings to service_role;

-- p_rating null clears the rating (the founder pressed the same thumb again).
create or replace function public.rate_agent_turn(p_session uuid, p_turn integer, p_rating text, p_reason text default null)
returns public.agent_turn_ratings
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.agent_turn_ratings;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_rating is not null and p_rating not in ('up', 'down') then
    raise exception 'A rating is up or down.' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'Keep the reason under 300 characters.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.agent_turns t
    join public.agent_sessions s on s.id = t.session_id
    where s.id = p_session and s.user_id = v_user and t.number = p_turn
  ) then
    raise exception 'Answer not found.' using errcode = 'P0002';
  end if;
  if p_rating is null then
    delete from public.agent_turn_ratings where session_id = p_session and turn_number = p_turn returning * into v_row;
    return v_row;
  end if;
  insert into public.agent_turn_ratings (session_id, turn_number, user_id, rating, reason)
  values (p_session, p_turn, v_user, p_rating, v_reason)
  on conflict (session_id, turn_number)
  do update set rating = excluded.rating, reason = excluded.reason, updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.rate_agent_turn(uuid, integer, text, text) from public, anon;
grant execute on function public.rate_agent_turn(uuid, integer, text, text) to authenticated;

create or replace function public.agent_open_cmo_session(p_model text, p_new boolean DEFAULT false) RETURNS public.agent_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_session public.agent_sessions;
begin
  if p_model is null or char_length(p_model) > 64 or not exists (
    select 1 from public.agent_model_prices p
    where p.allowed and p.pattern <> 'default' and p_model like p.pattern
  ) then
    raise exception 'Unknown assistant model.' using errcode = '22023';
  end if;
  if not coalesce(p_new, false) then
    select * into v_session from public.agent_sessions
    where user_id = v_user and scope = 'cmo' and model = p_model
    order by created_at desc limit 1;
    -- A full conversation is not reused: the chat sends a window of it, but the panel and the turn numbers keep
    -- growing, so past 200 turns the next message starts a new conversation.
    if found and (select count(*) from public.agent_turns where session_id = v_session.id) < 200 then
      return v_session;
    end if;
  end if;
  -- Counted under a lock: parallel requests all passed a plain count before any of them committed.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':cmo_session', 0));
  if (select count(*) from public.agent_sessions
      where user_id = v_user and scope = 'cmo' and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many new conversations in the last hour. Try again later.' using errcode = 'P0001';
  end if;
  insert into public.agent_sessions(user_id, scope, model)
  values (v_user, 'cmo', p_model) returning * into v_session;
  return v_session;
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
      or (p_bucket = 'uploads' and p_limit = 30 and p_window_seconds = 3600)
      or (p_bucket = 'jobs' and p_limit = 10 and p_window_seconds = 3600)
      or (p_bucket = 'retry' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'draft' and p_limit = 120 and p_window_seconds = 60)
      or (p_bucket = 'project-write' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'mcp' and p_limit = 600 and p_window_seconds = 3600)
      -- P4: connecting and disconnecting social accounts (each call reaches Zernio).
      or (p_bucket = 'accounts' and p_limit = 30 and p_window_seconds = 3600)
      -- P4: moving a slot on the calendar and "I posted it" (`/api/v1/schedule/slots/[id]`).
      or (p_bucket = 'schedule' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'editor-write' and p_limit = 240 and p_window_seconds = 60)
      or (p_bucket = 'zip' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'media' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'scene_codes' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'feedback' and p_limit = 20 and p_window_seconds = 3600)
      -- 30 until motion quality A3 (PR #104) raised MCP previews to 60: both, so either PR can merge first.
      or (p_bucket = 'mcp_preview' and p_limit = 30 and p_window_seconds = 3600)
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


commit;
