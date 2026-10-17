-- MCP server on Modal (docs/mcp-on-modal-plan.md, Session A: A5 and A9).
--
-- 1. `mcp_preview`: explainer previews over MCP render on our machines with no agent credits
--    behind them (in the app the Assistant turn pays for them), so each user gets 30 an hour.
-- 2. `mcp_confirm_use`: the MCP server is stateless and its price step hands the client a signed
--    confirm code. The signature stops a changed spec, not a replay: the same code sent twice would
--    place the same generation twice. Each code carries a nonce that can be used once.

create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
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
      or (p_bucket = 'editor-write' and p_limit = 240 and p_window_seconds = 60)
      or (p_bucket = 'zip' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'media' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'scene_codes' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'feedback' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_preview' and p_limit = 30 and p_window_seconds = 3600);
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


create table public.mcp_confirms (
  user_id uuid not null references auth.users(id) on delete cascade,
  nonce uuid not null,
  used_at timestamptz not null default now(),
  primary key (user_id, nonce)
);

-- Written only through mcp_confirm_use; nobody reads it.
alter table public.mcp_confirms enable row level security;
revoke all on table public.mcp_confirms from anon, authenticated;

create index mcp_confirms_used_at on public.mcp_confirms (user_id, used_at);

-- true the first time the caller uses this nonce, false after. A code lives 10 minutes, so a day
-- of history is more than enough; older rows of the same user are cleared on the way.
create or replace function public.mcp_confirm_use(p_nonce uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_count int;
begin
  if p_nonce is null then
    raise exception 'That confirm code is not valid. Ask for the price again.' using errcode = '22023';
  end if;
  delete from public.mcp_confirms where user_id = v_user and used_at < now() - interval '1 day';
  insert into public.mcp_confirms (user_id, nonce) values (v_user, p_nonce) on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.mcp_confirm_use(uuid) from public, anon;
grant execute on function public.mcp_confirm_use(uuid) to authenticated;
