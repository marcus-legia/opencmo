-- cmo-review B1.7: a founder's time zone comes from their browser, not the 'UTC' default.
--
-- Schedule slots, the digest hour and "best time" all run in profiles.timezone, which every account gets as 'UTC'
-- and only changes when the founder opens Settings. The app now sends the browser's zone once; it is written only
-- while the zone was never chosen, so a founder's own choice (even UTC) is never overwritten.

alter table public.profiles
  add column if not exists timezone_source text not null default 'default';

do $$ begin
  alter table public.profiles add constraint profiles_timezone_source_check
    check (timezone_source in ('default', 'browser', 'founder'));
exception when duplicate_object then null; end $$;

-- A zone other than the default was set by the founder in Settings (the only writer until now).
update public.profiles set timezone_source = 'founder' where timezone <> 'UTC' and timezone_source = 'default';

create or replace function public.profile_timezone_detect(p_timezone text)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_zone text;
begin
  -- An unknown name is ignored, not an error: this runs unattended on app load.
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    return (select timezone from public.profiles where id = v_user);
  end if;
  update public.profiles
  set timezone = p_timezone, timezone_source = 'browser'
  where id = v_user and timezone_source = 'default'
  returning timezone into v_zone;
  return coalesce(v_zone, (select timezone from public.profiles where id = v_user));
end;
$$;
revoke all on function public.profile_timezone_detect(text) from public, anon;
grant execute on function public.profile_timezone_detect(text) to authenticated;

-- Saving Settings is the founder's choice: the browser never overwrites it afterwards.
create or replace function public.save_cmo_settings(p_weekly_credit_budget integer, p_timezone text, p_digest_hour smallint)
returns table (weekly_credit_budget integer, timezone text, digest_hour smallint)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  if p_weekly_credit_budget is null or p_weekly_credit_budget < 0 or p_weekly_credit_budget > 10000 then
    raise exception 'The weekly budget must be between 0 and 10,000 credits.' using errcode = '22023';
  end if;
  -- pg_timezone_names is the list `at time zone` accepts; an unknown name would fail every digest later.
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a time zone from the list.' using errcode = '22023';
  end if;
  if p_digest_hour is not null and (p_digest_hour < 0 or p_digest_hour > 23) then
    raise exception 'The digest hour must be between 0 and 23.' using errcode = '22023';
  end if;
  update public.profiles p
  set weekly_credit_budget = p_weekly_credit_budget, timezone = p_timezone, digest_hour = p_digest_hour,
      timezone_source = 'founder'
  where p.id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  return query select p.weekly_credit_budget, p.timezone, p.digest_hour from public.profiles p where p.id = v_user;
end;
$$;
revoke all on function public.save_cmo_settings(integer, text, smallint) from public, anon;
grant execute on function public.save_cmo_settings(integer, text, smallint) to authenticated;
