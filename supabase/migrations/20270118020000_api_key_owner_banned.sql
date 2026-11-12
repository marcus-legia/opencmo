-- An API key stops working when its account is banned or deleted.
--
-- The MCP server turns a key into a user id with `api_key_owner` and then signs its own five-minute JWT for that
-- user. PostgREST accepts that JWT on its signature alone, so nothing on this path ever asked Supabase Auth about
-- the account: banning an abusive account stopped its browser sessions (every write of the web API asks Auth) and
-- its OAuth connections (checked with Auth on each request), but its API keys kept running tools and spending
-- credits. The lookup is the one place every key passes through, so the account is checked here.

create or replace function public.api_key_owner(p_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select k.user_id into v_user
  from public.api_keys k
  join auth.users u on u.id = k.user_id
  where k.key_hash = p_hash and k.revoked_at is null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now());

  if v_user is not null then
    update public.api_keys set last_used_at = now()
    where key_hash = p_hash
      and (last_used_at is null or last_used_at < now() - interval '5 minutes');
  end if;
  return v_user;
end;
$$;

revoke all on function public.api_key_owner(text) from public, anon, authenticated;
grant execute on function public.api_key_owner(text) to service_role;
