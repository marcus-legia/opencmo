-- Review of #238, finding 7: the settings route read the profile, then wrote every field back, so two panels saving at
-- once could undo each other (the Notifications panel's hour reverted by the Your CMO panel's save). One statement now
-- changes only the keys the request names; a key with null (`digest_hour`) still means "no morning email hour".
create function public.save_cmo_settings_patch(p_patch jsonb)
returns table (weekly_credit_budget integer, timezone text, digest_hour smallint, digest_days text)
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_budget integer;
  v_zone text;
  v_hour smallint;
  v_days text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  if p_patch ? 'weekly_credit_budget' then
    v_budget := (p_patch->>'weekly_credit_budget')::integer;
    if v_budget is null or v_budget < 0 or v_budget > 10000 then
      raise exception 'The weekly budget must be between 0 and 10,000 credits.' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'timezone' then
    v_zone := p_patch->>'timezone';
    if v_zone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_zone) then
      raise exception 'Choose a time zone from the list.' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'digest_hour' then
    v_hour := (p_patch->>'digest_hour')::smallint;
    if v_hour is not null and (v_hour < 0 or v_hour > 23) then
      raise exception 'The digest hour must be between 0 and 23.' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'digest_days' then
    v_days := p_patch->>'digest_days';
    if v_days is null or v_days not in ('weekdays', 'daily', 'monday', 'off') then
      raise exception 'Choose weekdays, every day, Mondays or off.' using errcode = '22023';
    end if;
  end if;
  update public.profiles p set
    weekly_credit_budget = case when p_patch ? 'weekly_credit_budget' then v_budget else p.weekly_credit_budget end,
    timezone = case when p_patch ? 'timezone' then v_zone else p.timezone end,
    timezone_source = case when p_patch ? 'timezone' then 'founder' else p.timezone_source end,
    digest_hour = case when p_patch ? 'digest_hour' then v_hour else p.digest_hour end,
    digest_days = case when p_patch ? 'digest_days' then v_days else p.digest_days end
  where p.id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  return query select p.weekly_credit_budget, p.timezone, p.digest_hour, p.digest_days from public.profiles p where p.id = v_user;
end;
$$;

revoke all on function public.save_cmo_settings_patch(jsonb) from public, anon;
grant execute on function public.save_cmo_settings_patch(jsonb) to authenticated, service_role;
