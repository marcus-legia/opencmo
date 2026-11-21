-- Launch measurement (review 2026-11-21, note 12's 4-week gate): where a founder came from, the free scan in the owner's
-- funnel, and an anonymous outcome kept when an account is deleted.
--
-- 1. `profiles.first_touch`: the first `ref` / `utm_*` / referring host, set once by the founder's own session right
--    after sign-up (`profile_set_first_touch`, called by /auth/callback; the value travels in a first-party cookie,
--    `apps/web/lib/ops/first-touch.ts`). Without it the launch week's `?ref=ph` / `?ref=hn` links counted nothing.
-- 2. `heard_from` gains Product Hunt, Hacker News and Threads, the launch week's channels.
-- 3. `signup_outcomes`: one anonymous row per deleted account (no user id, no email): the day it signed up, its channel,
--    whether the free scan ran and found anyone, whether it paid. Free accounts are deleted 30 days after sign-up, which
--    took the trial-to-paid numbers with them exactly when the gate reads them. Owner only, written by the purge.
-- 4. `cmo_funnel_report` adds "Ran the free scan" and "Free scan found someone", and a by-channel table.

alter table public.profiles add column if not exists first_touch jsonb;
alter table public.profiles drop constraint if exists profiles_first_touch_check;
alter table public.profiles add constraint profiles_first_touch_check
  check (first_touch is null or (jsonb_typeof(first_touch) = 'object' and octet_length(first_touch::text) <= 1000));

alter table public.profiles drop constraint if exists profiles_heard_from_check;
alter table public.profiles add constraint profiles_heard_from_check check (heard_from is null or heard_from in
  ('search', 'x', 'reddit', 'linkedin', 'youtube', 'ai_assistant', 'friend', 'newsletter', 'product_hunt', 'hacker_news',
   'threads', 'other'));

-- The channel a first touch names, in one place: a campaign tag, else the linking site, else direct.
create or replace function public.first_touch_channel(p_touch jsonb) returns text
  language sql immutable
  set search_path to ''
as $$
  select coalesce(
    nullif(p_touch->>'ref', ''),
    nullif(p_touch->>'utm_source', ''),
    nullif(p_touch->>'referrer_host', ''),
    'direct'
  );
$$;

revoke all on function public.first_touch_channel(jsonb) from public, anon, authenticated;

-- The founder's own session keeps its first touch once, within a day of sign-up. Only known keys, each a short tag
-- (the client and the callback clean them the same way: three layers).
create or replace function public.profile_set_first_touch(p_touch jsonb) returns boolean
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_clean jsonb := '{}'::jsonb;
  v_key text;
  v_value text;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_touch is null or jsonb_typeof(p_touch) <> 'object' then
    return false;
  end if;
  foreach v_key in array array['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'referrer_host', 'landing_path', 'day'] loop
    v_value := p_touch->>v_key;
    if v_value is not null and char_length(v_value) between 1 and 100 and v_value ~ '^[A-Za-z0-9/._-]+$' then
      v_clean := v_clean || jsonb_build_object(v_key, v_value);
    end if;
  end loop;
  if v_clean = '{}'::jsonb then
    return false;
  end if;
  update public.profiles p set first_touch = v_clean
  where p.id = v_user and p.first_touch is null
    and exists (select 1 from auth.users u where u.id = v_user and u.created_at > now() - interval '1 day');
  return found;
end;
$$;

revoke all on function public.profile_set_first_touch(jsonb) from public, anon;
grant execute on function public.profile_set_first_touch(jsonb) to authenticated;

create table if not exists public.signup_outcomes (
  id bigint generated always as identity primary key,
  signup_day date not null,
  channel text not null,
  heard_from text,
  free_scan boolean not null default false,
  people_found integer not null default 0,
  paid boolean not null default false,
  deleted_as text not null check (deleted_as in ('self', 'unpaid')),
  recorded_at timestamptz not null default now()
);
alter table public.signup_outcomes enable row level security;
revoke all on table public.signup_outcomes from public, anon, authenticated;

-- One anonymous row for an account about to be deleted. Called by the purge, before the account's rows go.
create or replace function public.record_signup_outcome(p_user uuid, p_source text) returns void
  language sql security definer
  set search_path to ''
as $$
  insert into public.signup_outcomes (signup_day, channel, heard_from, free_scan, people_found, paid, deleted_as)
  select
    (coalesce(u.created_at, now()) at time zone 'utc')::date,
    public.first_touch_channel(p.first_touch),
    p.heard_from,
    exists (select 1 from public.cmo_runs r where r.user_id = p_user and r.kind = 'sales_scan' and r.status = 'done' and r.output->>'free' = 'true'),
    (select count(*)::integer from public.opportunities o where o.user_id = p_user),
    public.account_is_paid(p_user),
    p_source
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user;
$$;

revoke all on function public.record_signup_outcome(uuid, text) from public, anon, authenticated;

-- Set once a deleted account's outcome is recorded, so a purge retried after a failed deleteUser does not count it twice.
alter table public.account_deletions add column if not exists outcome_recorded boolean not null default false;

-- Redeclares the current purge (20270202020000) with one line in each loop: the outcome is recorded first.
create or replace function public.purge_unpaid_accounts(p_limit integer default 50) returns setof uuid
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid;
  v_left integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500.';
  end if;
  v_left := p_limit;

  for v_user in
    select d.user_id
    from public.account_deletions d
    where d.done_at is null and d.source = 'self'
      and exists (select 1 from auth.users u where u.id = d.user_id)
      -- Work still running (the worker holds a lease): leave it to the next cron run.
      and not exists (
        select 1 from public.tasks t
        where t.user_id = d.user_id and t.status in ('queued', 'running')
      )
    order by d.requested_at
    limit v_left
    for update of d skip locked
  loop
    -- A retry after a failed deleteUser must not count the account twice.
    if not exists (select 1 from public.account_deletions d where d.user_id = v_user and d.done_at is null and d.outcome_recorded) then
      perform public.record_signup_outcome(v_user, 'self');
      update public.account_deletions set outcome_recorded = true where user_id = v_user and done_at is null;
    end if;
    -- Files uploaded after the founder asked are queued too.
    perform public.account_purge_files(v_user);
    v_left := v_left - 1;
    return next v_user;
  end loop;

  if v_left < 1 then
    return;
  end if;

  for v_user in
    select p.id
    from public.profiles p
    where p.retention_from + interval '30 days' < now()
      and not public.account_is_paid(p.id)
      and not exists (
        select 1 from public.tasks t
        where t.user_id = p.id and t.status in ('queued', 'running')
      )
      -- An unpaid pick whose `deleteUser` failed is checked again here, so an account that paid since is kept.
      and not exists (
        select 1 from public.account_deletions d where d.user_id = p.id and d.done_at is null and d.source = 'self'
      )
    order by p.retention_from
    limit v_left
    for update of p skip locked
  loop
    if not exists (select 1 from public.account_deletions d where d.user_id = v_user and d.done_at is null and d.outcome_recorded) then
      perform public.record_signup_outcome(v_user, 'unpaid');
    end if;
    perform public.account_purge_files(v_user);
    insert into public.account_deletions (user_id, source, outcome_recorded) values (v_user, 'unpaid', true)
    on conflict (user_id) where done_at is null do update set outcome_recorded = true;
    return next v_user;
  end loop;
end;
$$;


-- The owner's funnel, redeclared from 20270126010000 with the free scan steps and a by-channel table.
create or replace function public.cmo_funnel_report(p_days integer default 30) returns jsonb
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_since timestamptz;
  v_result jsonb;
begin
  if not exists (select 1 from public.app_owners where email = v_email) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Pick 1 to 365 days.' using errcode = '22023';
  end if;
  v_since := date_trunc('day', now() at time zone 'utc') at time zone 'utc' - make_interval(days => p_days - 1);

  with cohort as (
    select u.id, u.created_at
    from auth.users u
    where u.created_at >= v_since
      and lower(coalesce(u.email, '')) not in (select email from public.app_owners)
  ),
  firsts as (
    select c.id, c.created_at,
      (select min(e.at) from public.product_events e where e.user_id = c.id and e.kind = 'onboarded') as onboarded_at,
      (select min(e.at) from public.product_events e where e.user_id = c.id and e.kind = 'approve') as approved_at,
      (select min(e.at) from public.product_events e where e.user_id = c.id and e.kind = 'schedule') as scheduled_at,
      (select min(e.at) from public.product_events e where e.user_id = c.id and e.kind = 'posted') as posted_at,
      -- Active: approved something in the last 7 days, counted only for accounts at least 7 days old.
      exists (select 1 from public.product_events e where e.user_id = c.id and e.kind = 'approve' and e.at >= now() - interval '7 days')
        as active_7d,
      public.cmo_paid(c.id) as paid,
      exists (select 1 from public.cmo_runs r where r.user_id = c.id and r.kind = 'sales_scan' and r.status = 'done' and r.output->>'free' = 'true') as free_scan,
      exists (select 1 from public.opportunities o where o.user_id = c.id) as found_someone,
      public.first_touch_channel((select p.first_touch from public.profiles p where p.id = c.id)) as channel
    from cohort c
  ),
  median as (
    select
      percentile_cont(0.5) within group (order by extract(epoch from onboarded_at - created_at)) filter (where onboarded_at is not null) as onboarded_s,
      percentile_cont(0.5) within group (order by extract(epoch from approved_at - created_at)) filter (where approved_at is not null) as approved_s,
      percentile_cont(0.5) within group (order by extract(epoch from posted_at - created_at)) filter (where posted_at is not null) as posted_s
    from firsts
  )
  select jsonb_build_object(
    'since', v_since,
    'steps', jsonb_build_array(
      jsonb_build_object('step', 'signed_up', 'users', (select count(*) from firsts)),
      jsonb_build_object('step', 'onboarded', 'users', (select count(*) from firsts where onboarded_at is not null)),
      jsonb_build_object('step', 'free_scan', 'users', (select count(*) from firsts where free_scan)),
      jsonb_build_object('step', 'found', 'users', (select count(*) from firsts where found_someone)),
      jsonb_build_object('step', 'approved', 'users', (select count(*) from firsts where approved_at is not null)),
      jsonb_build_object('step', 'scheduled', 'users', (select count(*) from firsts where scheduled_at is not null)),
      jsonb_build_object('step', 'posted', 'users', (select count(*) from firsts where posted_at is not null)),
      jsonb_build_object('step', 'paid', 'users', (select count(*) from firsts where paid))
    ),
    'median_seconds', (select jsonb_build_object('onboarded', round(onboarded_s), 'approved', round(approved_s), 'posted', round(posted_s)) from median),
    'active_7d', jsonb_build_object(
      'eligible', (select count(*) from firsts where created_at <= now() - interval '7 days'),
      'active', (select count(*) from firsts where created_at <= now() - interval '7 days' and active_7d),
      'paid_eligible', (select count(*) from firsts where created_at <= now() - interval '7 days' and paid),
      'paid_active', (select count(*) from firsts where created_at <= now() - interval '7 days' and paid and active_7d)
    ),
    -- Accounts still here, plus the anonymous outcomes of those deleted since (free accounts go after 30 days).
    'by_channel', coalesce((select jsonb_agg(ch order by ch.signed_up desc) from (
      select channel, sum(signed_up)::integer as signed_up, sum(free_scan)::integer as free_scan,
        sum(found_n)::integer as found, sum(paid)::integer as paid
      from (
        select channel, 1 as signed_up, free_scan::int as free_scan, found_someone::int as found_n, paid::int as paid from firsts
        union all
        select o.channel, 1, o.free_scan::int, (o.people_found > 0)::int, o.paid::int
        from public.signup_outcomes o where o.signup_day >= (v_since at time zone 'utc')::date
      ) x group by channel
    ) ch), '[]'::jsonb),
    'by_week', coalesce((select jsonb_agg(w order by w.week) from (
      select date_trunc('week', created_at at time zone 'utc')::date as week,
        count(*) as signed_up,
        count(onboarded_at) as onboarded,
        count(approved_at) as approved,
        count(posted_at) as posted,
        count(*) filter (where paid) as paid
      from firsts group by 1
    ) w), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- The onboarding answers, redeclared from the current schema with the launch channels in heard_from.
create or replace function public.cmo_onboarding_answers(p_answers jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := public.require_user();
  v_handle text;
  v_platforms text[];
  v_heard text;
  v_note text;
  v_sells text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 1024
     or exists (select 1 from jsonb_object_keys(p_answers) k where k not in ('x_handle', 'platforms', 'heard_from', 'heard_from_note', 'sells_to')) then
    raise exception 'These answers are not valid.' using errcode = '22023';
  end if;

  if p_answers ? 'x_handle' then
    v_handle := regexp_replace(btrim(coalesce(p_answers->>'x_handle', '')), '^@', '');
    if v_handle !~ '^[A-Za-z0-9_]{1,15}$' then
      raise exception 'An X handle has 1 to 15 letters, numbers or underscores.' using errcode = '22023';
    end if;
  end if;
  if p_answers ? 'platforms' then
    if jsonb_typeof(p_answers->'platforms') <> 'array' then
      raise exception 'These answers are not valid.' using errcode = '22023';
    end if;
    select array_agg(distinct v) into v_platforms from jsonb_array_elements_text(p_answers->'platforms') v;
    if v_platforms is null or not (v_platforms <@ array['x', 'threads', 'linkedin']) then
      raise exception 'Pick X, Threads or LinkedIn.' using errcode = '22023';
    end if;
  end if;
  if p_answers ? 'heard_from' then
    v_heard := p_answers->>'heard_from';
    if v_heard is null or v_heard not in ('search', 'x', 'reddit', 'linkedin', 'youtube', 'ai_assistant', 'friend', 'newsletter', 'product_hunt',
      'hacker_news', 'threads', 'other') then
      raise exception 'These answers are not valid.' using errcode = '22023';
    end if;
    v_note := nullif(left(btrim(coalesce(p_answers->>'heard_from_note', '')), 100), '');
  elsif p_answers ? 'heard_from_note' then
    raise exception 'These answers are not valid.' using errcode = '22023';
  end if;
  if p_answers ? 'sells_to' then
    v_sells := btrim(regexp_replace(coalesce(p_answers->>'sells_to', ''), '\s+', ' ', 'g'));
    if jsonb_typeof(p_answers->'sells_to') <> 'string' or char_length(v_sells) not between 1 and 160 then
      raise exception 'Say who you sell to in 1 to 160 characters.' using errcode = '22023';
    end if;
  end if;

  update public.profiles set
    x_handle = coalesce(v_handle, x_handle),
    post_platforms = coalesce(v_platforms, post_platforms),
    heard_from = coalesce(v_heard, heard_from),
    heard_from_note = case when v_heard is not null then v_note else heard_from_note end,
    sells_to = coalesce(v_sells, sells_to)
  where id = v_user;

  perform public.cmo_apply_onboarding_answers(v_user, v_handle is not null, v_sells is not null);
end;
$_$;


--
-- Name: cmo_paid(uuid); Type: FUNCTION; Schema: public; Owner: -
--

create or replace function public.cmo_paid(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((select p.plan in ('starter', 'creator') or p.credit_balance > 0 from public.profiles p where p.id = p_user), false);
$$;
