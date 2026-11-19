-- Wave 2 A4 (docs/plans/cmo/2026-11-19-wave2-plan.md): the morning email's schedule and the log Settings shows.
--
-- - `profiles.digest_days`: weekdays (default), daily, monday or off; the morning hour's default becomes 8.
-- - `email_log` keeps what a founder needs to read it back: the subject, a short summary, and the days nothing was
--   sent (`skipped`). Kinds are digest, weekly and push; `expiring` stays readable on old rows, and no new ones are
--   claimed (the expiring-card email is gone).
-- - A digest may be logged without card ids: a morning with only follow-ups, or a skipped one, has none.
-- - `my_email_log(p_limit)`: the founder's own log of the last 14 days, newest first.

alter table public.profiles
  add column digest_days text not null default 'weekdays'
    constraint profiles_digest_days_check check (digest_days in ('weekdays', 'daily', 'monday', 'off'));
alter table public.profiles alter column digest_hour set default 8;

alter table public.email_log
  add column subject text constraint email_log_subject_check check (char_length(subject) <= 200),
  add column summary jsonb constraint email_log_summary_check check (
    jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 4096);
alter table public.email_log drop constraint email_log_approval_ids_check;
alter table public.email_log add constraint email_log_approval_ids_check check (
  cardinality(approval_ids) <= 50 and (cardinality(approval_ids) >= 1 or kind in ('digest', 'weekly')));
alter table public.email_log drop constraint email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check check (kind in ('digest', 'weekly', 'push', 'expiring'));
alter table public.email_log drop constraint email_log_status_check;
alter table public.email_log add constraint email_log_status_check check (status in ('claimed', 'sent', 'failed', 'skipped'));
create unique index email_log_one_weekly on public.email_log (user_id, day) where kind = 'weekly';

-- The claim before a send. A digest or weekly email may carry no card (follow-ups only); a push names its post's card.
-- An email the founder turned off (unsubscribed, or `digest_days = 'off'`) is never claimed; a push follows the
-- browser's own permission instead.
drop function public.email_log_claim(uuid, text, uuid[]);
create function public.email_log_claim(
  p_user uuid, p_kind text, p_approval_ids uuid[], p_subject text default null, p_summary jsonb default null
) returns table (log_id uuid, approval_ids uuid[])
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_day date := (now() at time zone public.schedule_timezone(p_user))::date;
  v_ids uuid[];
  v_id uuid;
begin
  if p_kind not in ('digest', 'weekly', 'push', 'expiring') then
    raise exception 'Unknown email kind.' using errcode = '22023';
  end if;
  -- The expiring-card email is gone (wave 2): an old caller gets nothing to send, not an error.
  if p_kind = 'expiring' then
    return;
  end if;
  if p_summary is not null and (jsonb_typeof(p_summary) <> 'object' or octet_length(p_summary::text) > 4096) then
    raise exception 'An email summary is a small object.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('email_log:' || p_user::text, 0));
  if p_kind in ('digest', 'weekly') and (
    exists (select 1 from public.notify_settings n where n.user_id = p_user and not n.email_digest)
    or exists (select 1 from public.profiles p where p.id = p_user and p.digest_days = 'off')
  ) then
    return;
  end if;
  -- Only the founder's own cards that still wait.
  select coalesce(array_agg(a.id order by a.created_at), '{}') into v_ids
  from public.approvals a
  where a.id = any(coalesce(p_approval_ids, '{}')) and a.user_id = p_user and a.status = 'waiting';
  if p_kind = 'push' then
    -- One push per card.
    select coalesce(array_agg(i order by i), '{}') into v_ids from unnest(v_ids) i
    where not exists (select 1 from public.email_log l
                      where l.user_id = p_user and l.kind = 'push' and l.status <> 'failed' and i = any(l.approval_ids));
    if cardinality(v_ids) = 0 then
      return;
    end if;
  end if;
  v_ids := v_ids[1:50];
  insert into public.email_log (user_id, kind, day, approval_ids, subject, summary)
  values (p_user, p_kind, v_day, v_ids, left(nullif(btrim(coalesce(p_subject, '')), ''), 200), p_summary)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return;
  end if;
  return query select v_id, v_ids;
end;
$$;

revoke all on function public.email_log_claim(uuid, text, uuid[], text, jsonb) from public, anon, authenticated;
grant execute on function public.email_log_claim(uuid, text, uuid[], text, jsonb) to service_role;

-- A morning with nothing new: logged as skipped, so the log shows it and the hour's later runs do not send that day.
create function public.email_log_skip(p_user uuid, p_kind text, p_summary jsonb default null)
returns uuid
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if p_kind not in ('digest', 'weekly') then
    raise exception 'Only a digest or weekly email can be skipped.' using errcode = '22023';
  end if;
  if p_summary is not null and (jsonb_typeof(p_summary) <> 'object' or octet_length(p_summary::text) > 4096) then
    raise exception 'An email summary is a small object.' using errcode = '22023';
  end if;
  insert into public.email_log (user_id, kind, day, approval_ids, status, summary)
  values (p_user, p_kind, (now() at time zone public.schedule_timezone(p_user))::date, '{}', 'skipped', p_summary)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.email_log_skip(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.email_log_skip(uuid, text, jsonb) to service_role;

-- Settings › Notifications: what was sent or skipped, newest first. Claims still open and failures are not shown;
-- owners read failures at /app/settings/failures.
create function public.my_email_log(p_limit integer default 30)
returns table (id uuid, kind text, day date, status text, subject text, summary jsonb, created_at timestamptz, sent_at timestamptz)
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Pick 1 to 100 emails.' using errcode = '22023';
  end if;
  return query
    select l.id, l.kind, l.day, l.status, l.subject, l.summary, l.created_at, l.sent_at
    from public.email_log l
    where l.user_id = v_user and l.status in ('sent', 'skipped') and l.created_at > now() - interval '14 days'
    order by l.created_at desc
    limit p_limit;
end;
$$;

revoke all on function public.my_email_log(integer) from public, anon;
grant execute on function public.my_email_log(integer) to authenticated, service_role;

-- The settings save takes the days too; null keeps them, so an older client does not change the schedule.
drop function public.save_cmo_settings(integer, text, smallint);
create function public.save_cmo_settings(
  p_weekly_credit_budget integer, p_timezone text, p_digest_hour smallint, p_digest_days text default null
) returns table (weekly_credit_budget integer, timezone text, digest_hour smallint, digest_days text)
  language plpgsql security definer
  set search_path to 'public'
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
  if p_digest_days is not null and p_digest_days not in ('weekdays', 'daily', 'monday', 'off') then
    raise exception 'Choose weekdays, every day, Mondays or off.' using errcode = '22023';
  end if;
  update public.profiles p
  set weekly_credit_budget = p_weekly_credit_budget, timezone = p_timezone, digest_hour = p_digest_hour,
      digest_days = coalesce(p_digest_days, p.digest_days), timezone_source = 'founder'
  where p.id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  return query select p.weekly_credit_budget, p.timezone, p.digest_hour, p.digest_days from public.profiles p where p.id = v_user;
end;
$$;

revoke all on function public.save_cmo_settings(integer, text, smallint, text) from public, anon;
grant execute on function public.save_cmo_settings(integer, text, smallint, text) to authenticated, service_role;
