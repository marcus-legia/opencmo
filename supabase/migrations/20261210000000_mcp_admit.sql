-- MCP admission in one call (security fixes plan, items 2 and 5:
-- docs/plans/security/2026-10-17-mcp-auth-api-fixes-plan.md).
--
-- 1. `mcp_admit(p_count)`: the MCP server used to call `rate_limit_hit('mcp', …)` once per
--    JSON-RPC message, so a batch of 20 cost 20 round trips. This does the plan check (free
--    accounts cannot use MCP at all), the 1–20 bound and the 600-an-hour `mcp` bucket, counted
--    `p_count` times, in one call. Same bucket and window as `rate_limit_hit`, so both count together.
-- 2. `api_key_owner`: every MCP request wrote its key's row. `last_used_at` is shown as a day, so
--    writing it at most every 5 minutes loses nothing.
-- Uses `is_paid` (20261210100000): plpgsql resolves it when called, not when created.

create or replace function public.mcp_admit(p_count integer)
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_window_start timestamptz;
  v_count int;
begin
  if p_count is null or p_count < 1 or p_count > 20 then
    raise exception 'Send 1 to 20 messages per request.' using errcode = '22023';
  end if;
  -- Before counting: a free account's refused requests must not fill a bucket it cannot use.
  if not public.is_paid(v_user) then
    return 'free_plan';
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from now()) / 3600) * 3600);
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (v_user, 'mcp', v_window_start, p_count)
  on conflict (user_id, bucket, window_start)
  do update set count = public.rate_limits.count + p_count
  returning count into v_count;

  return case when v_count <= 600 then 'ok' else 'rate_limited' end;
end;
$$;

revoke all on function public.mcp_admit(integer) from public, anon;
grant execute on function public.mcp_admit(integer) to authenticated, service_role;


create or replace function public.api_key_owner(p_hash text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid;
begin
  select user_id into v_user
  from public.api_keys
  where key_hash = p_hash and revoked_at is null;

  if v_user is not null then
    update public.api_keys set last_used_at = now()
    where key_hash = p_hash
      and (last_used_at is null or last_used_at < now() - interval '5 minutes');
  end if;
  return v_user;
end;
$$;

revoke execute on function public.api_key_owner(text) from public, anon, authenticated;
grant execute on function public.api_key_owner(text) to service_role;
