-- Free accounts: no MCP keys, no free-cost CMO runs (security fixes plan, fix 5).
--
-- 1. `create_api_key`: an API key's only use is MCP, and MCP is a paid-plan feature. Existing keys
--    of free users stay listed so they can be revoked; `mcp_admit` stops them working.
-- 2. `cmo_enqueue`: `brain = 'claude'` (the founder's Claude thinks, over MCP) was priced at 0 for
--    anyone, and `enqueue_cmo_run` is callable by `authenticated` through PostgREST. A free user
--    could set the flag and get every CMO run for nothing. Now 0 only for paid users; others pay
--    the normal price. Replays still insert directly in `inbox_submit`, unchanged.

create or replace function public.create_api_key(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_key text;
  v_row public.api_keys;
begin
  if not public.is_paid(v_user) then
    -- P0001 so the route shows the message (lib/api/errors.ts passes it through).
    raise exception 'API keys are part of the paid plans.' using errcode = 'P0001';
  end if;
  if v_name = '' or char_length(v_name) > 60 then
    raise exception 'Name the key in 1 to 60 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.api_keys where user_id = v_user and revoked_at is null) >= 10 then
    raise exception 'You already have 10 active keys. Revoke one first.' using errcode = 'P0001';
  end if;
  v_key := 'ocm_' || encode(gen_random_bytes(24), 'hex');
  insert into public.api_keys (user_id, name, prefix, key_hash)
  values (v_user, v_name, left(v_key, 12), encode(digest(v_key, 'sha256'), 'hex'))
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'prefix', v_row.prefix, 'created_at', v_row.created_at, 'key', v_key);
end;
$$;

create or replace function public.cmo_enqueue(p_user uuid, p_kind text, p_input jsonb)
returns public.cmo_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cmo_runs;
  v_price integer := case
    when p_input->>'brain' = 'claude' and public.is_paid(p_user) then 0
    else public.cmo_job_price(p_kind)
  end;
begin
  if p_kind is null or p_kind = 'onboard' or public.cmo_job_daily_limit(p_kind) <= 0 then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 4096 then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  -- Replays are started by inbox_submit only, for an item the founder owns.
  if p_input ? 'inbox' then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':cmo_run', 1713));

  select * into v_row from public.cmo_runs
  where user_id = p_user and kind = p_kind and status in ('queued', 'running')
    and (status = 'queued' or lease_until is null or lease_until > now())
  order by created_at desc limit 1;
  if found then
    return v_row;
  end if;

  if (select count(*) from public.cmo_runs
      where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day'
        and not (input ? 'inbox')) >= public.cmo_job_daily_limit(p_kind) then
    raise exception 'You have reached today''s limit for this task. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if v_price > 0 and public.credit_balance(p_user) < v_price then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_price, public.credit_balance(p_user) using errcode = 'P0001';
  end if;

  insert into public.cmo_runs (user_id, kind, status, input, credits)
  values (p_user, p_kind, 'queued', p_input, v_price) returning * into v_row;
  if v_price > 0 then
    perform public.credit_hold(p_user, 'cmo_run', v_row.id, v_price, 'CMO hold');
  end if;
  return v_row;
end;
$$;
