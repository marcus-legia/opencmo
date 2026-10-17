-- 20261128100000: hourly caps on the reads the founder's Claude can make through MCP.
--
-- In mode B no agent credits stand behind a CMO tool call, but social reads (ScrapeCreators) and
-- `read_site` still cost OpenCMO money and load someone else's site. Kept apart from
-- rate_limit_hit (whose allowlist other migrations also replace): same table, own allowlist.

begin;

create or replace function public.cmo_read_limit(p_bucket text) returns integer
language sql immutable as $$
  select case p_bucket when 'mcp_social' then 60 when 'mcp_site' then 20 else 0 end
$$;

-- True while the founder is under the bucket's hourly cap (and counts this read).
create or replace function public.cmo_read_hit(p_bucket text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_limit integer := public.cmo_read_limit(p_bucket);
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / 3600) * 3600);
  v_count integer;
begin
  if v_limit <= 0 then
    raise exception 'Invalid rate limit.' using errcode = '22023';
  end if;
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (v_user, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return v_count <= v_limit;
end;
$$;

revoke all on function public.cmo_read_hit(text) from public, anon;
grant execute on function public.cmo_read_hit(text) to authenticated;

commit;
