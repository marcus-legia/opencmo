-- OAuth grants we own (security fixes plan, fix 6).
--
-- Supabase's OAuth server decides whether a token is valid; this table decides whether OpenCMO's
-- MCP server accepts it. The consent route records a row when the founder approves an allowlisted
-- app, Connected apps revokes it next to Supabase's `revokeGrant`, and the MCP server refuses a
-- token whose `client_id` has no active row. So a revoke takes effect on the next request,
-- whatever Supabase does with tokens already issued, and an app approved before this shipped (no
-- row) has to be connected again once.

create table public.mcp_grants (
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null check (char_length(client_id) between 1 and 200),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, client_id)
);

alter table public.mcp_grants enable row level security;
create policy mcp_grants_select_own on public.mcp_grants for select to authenticated using (user_id = auth.uid());
revoke all on public.mcp_grants from anon, authenticated;
grant select on public.mcp_grants to authenticated;

-- Approve again after a revoke: the same row comes back to life with a new date.
create or replace function public.mcp_grant_record(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  if p_client_id is null or char_length(p_client_id) not between 1 and 200 then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  -- The consent route checks this too; here it holds for any caller.
  if not public.is_paid(v_user) then
    raise exception 'Connecting apps to OpenCMO is part of the paid plans.' using errcode = 'P0001';
  end if;
  insert into public.mcp_grants (user_id, client_id) values (v_user, p_client_id)
  on conflict (user_id, client_id) do update set created_at = now(), revoked_at = null;
end;
$$;

create or replace function public.mcp_grant_revoke(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  update public.mcp_grants set revoked_at = now()
  where user_id = v_user and client_id = p_client_id and revoked_at is null;
end;
$$;

revoke all on function public.mcp_grant_record(text) from public, anon;
revoke all on function public.mcp_grant_revoke(text) from public, anon;
grant execute on function public.mcp_grant_record(text) to authenticated;
grant execute on function public.mcp_grant_revoke(text) to authenticated;
