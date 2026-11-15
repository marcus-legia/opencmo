-- Hardening backlog step 4 (docs/plans/engineering/2026-11-15-cmo-funnel-plan.md): the CMO funnel for the owner.
--
-- Read from what is already recorded: `auth.users` (sign-up), `product_events` (onboarded, approve, schedule, posted;
-- written by triggers since CMO review 3, 3.4) and `cmo_paid` (a plan, or credits bought). No vendor, no script in the
-- founder's browser, no new table.
--
-- The cohort is the accounts that signed up in the window; each step counts how many of them reached it, ever. Owner
-- accounts (`app_owners`) are left out, so testing the product does not count as a founder. Like
-- `provider_spend_report`, it answers only the emails in `app_owners`, under the owner's own session.

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
      public.cmo_paid(c.id) as paid
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

revoke all on function public.cmo_funnel_report(integer) from public, anon;
grant execute on function public.cmo_funnel_report(integer) to authenticated;
