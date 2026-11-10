-- CMO review 3, 3.4: one activation event, kept in our own database (no analytics vendor, no third-party script).
--
-- `product_events` records the funnel: onboarded → approve → schedule → posted, and a Sales reply copied. Triggers
-- write it from the rows the product already changes, each in its own function, so no product function (session A's
-- `approval_decide` and friends) is edited. A row is written once per thing (`unique (kind, ref_id)`), and a failure
-- to write one never fails the founder's action.
--
-- Nobody but the service role reads it: RLS on with no policy, no grant to anon or authenticated.

create table if not exists public.product_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('onboarded', 'approve', 'schedule', 'posted', 'reply_copied')),
  platform text check (platform is null or platform ~ '^[a-z_]{1,40}$'),
  paid boolean not null,
  -- What the event is about (the approval, the slot, the post, the thread; the account for `onboarded`).
  ref_id uuid not null,
  at timestamptz not null default now(),
  unique (kind, ref_id)
);

create index if not exists product_events_user_kind on public.product_events (user_id, kind, at);

alter table public.product_events enable row level security;
revoke all on public.product_events from public, anon, authenticated;
grant select, delete on public.product_events to service_role;

-- Internal: one event, at most once; never raises.
create or replace function public.product_event(p_user uuid, p_kind text, p_platform text, p_ref uuid) returns void
  language plpgsql security definer
  set search_path to 'public'
as $$
begin
  insert into public.product_events (user_id, kind, platform, paid, ref_id)
  values (p_user, p_kind, nullif(lower(regexp_replace(coalesce(p_platform, ''), '[^A-Za-z_]', '', 'g')), ''), public.cmo_paid(p_user), p_ref)
  on conflict (kind, ref_id) do nothing;
exception when others then
  raise warning 'product event % not recorded for %: %', p_kind, p_user, sqlerrm;
end;
$$;

revoke all on function public.product_event(uuid, text, text, uuid) from public, anon, authenticated;

-- onboarded: the onboarding run that saved the documents ends well. Once per account.
create or replace function public.product_events_onboarded() returns trigger
  language plpgsql security definer
  set search_path to 'public'
as $$
begin
  if new.kind = 'onboard' and new.status = 'done' and old.status is distinct from 'done' then
    perform public.product_event(new.user_id, 'onboarded', null, new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists product_events_onboarded on public.cmo_runs;
create trigger product_events_onboarded after update of status on public.cmo_runs
  for each row execute function public.product_events_onboarded();

-- approve: a post or reply card approved (as written or edited), however it was decided.
create or replace function public.product_events_approve() returns trigger
  language plpgsql security definer
  set search_path to 'public'
as $$
begin
  if new.kind in ('post', 'reply') and new.status in ('approved', 'edited') and old.status not in ('approved', 'edited') then
    perform public.product_event(new.user_id, 'approve', new.snapshot->>'platform', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists product_events_approve on public.approvals;
create trigger product_events_approve after update of status on public.approvals
  for each row execute function public.product_events_approve();

-- schedule: a slot made `waiting` (its time approved); posted: a slot published that has no post row of its own
-- (a short, a video). A post's own publication is recorded on the post below, so it is not counted twice.
create or replace function public.product_events_slot() returns trigger
  language plpgsql security definer
  set search_path to 'public'
as $$
begin
  if new.status = 'waiting' and (tg_op = 'INSERT' or old.status is distinct from 'waiting') then
    perform public.product_event(new.user_id, 'schedule', new.platform, new.id);
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and not exists (select 1 from public.deliverables d where d.id = new.deliverable_id and d.ref_kind = 'content_item') then
    perform public.product_event(new.user_id, 'posted', new.platform, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists product_events_slot on public.schedule_slots;
create trigger product_events_slot after insert or update of status on public.schedule_slots
  for each row execute function public.product_events_slot();

-- posted: a post published, by OpenCMO or by the founder ("I posted it").
create or replace function public.product_events_posted() returns trigger
  language plpgsql security definer
  set search_path to 'public'
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform public.product_event(new.user_id, 'posted', new.platform, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists product_events_posted on public.content_items;
create trigger product_events_posted after update of status on public.content_items
  for each row execute function public.product_events_posted();

-- reply_copied: a Sales thread marked replied (the founder copied the reply and posted it themselves).
create or replace function public.product_events_reply() returns trigger
  language plpgsql security definer
  set search_path to 'public'
as $$
begin
  if new.status = 'replied' and old.status is distinct from 'replied' then
    perform public.product_event(new.user_id, 'reply_copied', new.platform, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists product_events_reply on public.opportunities;
create trigger product_events_reply after update of status on public.opportunities
  for each row execute function public.product_events_reply();

-- The one question: per signup day, of the accounts that onboarded, how many approved a first post or reply within
-- 24 h, split by whether the account is paid now. Service role only.
create or replace view public.activation with (security_invoker = true) as
with onboarded as (
  select user_id, min(at) as at from public.product_events where kind = 'onboarded' group by user_id
), approved as (
  select user_id, min(at) as at from public.product_events where kind = 'approve' group by user_id
)
select
  (p.created_at at time zone 'UTC')::date as signup_day,
  public.cmo_paid(p.id) as paid,
  count(*)::integer as signups,
  count(o.user_id)::integer as onboarded,
  count(a.user_id) filter (where a.at <= o.at + interval '24 hours')::integer as approved_24h,
  round(100.0 * count(a.user_id) filter (where a.at <= o.at + interval '24 hours') / nullif(count(o.user_id), 0), 1) as approved_24h_pct
from public.profiles p
left join onboarded o on o.user_id = p.id
left join approved a on a.user_id = p.id
group by 1, 2;

revoke all on public.activation from public, anon, authenticated;
grant select on public.activation to service_role;

-- Trigger functions run as their owner; nobody calls them directly.
revoke all on function public.product_events_onboarded() from public, anon, authenticated;
revoke all on function public.product_events_approve() from public, anon, authenticated;
revoke all on function public.product_events_slot() from public, anon, authenticated;
revoke all on function public.product_events_posted() from public, anon, authenticated;
revoke all on function public.product_events_reply() from public, anon, authenticated;

-- Accounts that onboarded or approved before this migration: their first events, so `activation` does not read every
-- earlier signup as never onboarded. `paid` is the account's state now (the past state is not kept anywhere).
insert into public.product_events (user_id, kind, paid, ref_id, at)
select r.user_id, 'onboarded', public.cmo_paid(r.user_id), r.user_id, min(coalesce(r.finished_at, r.created_at))
from public.cmo_runs r
where r.kind = 'onboard' and r.status = 'done'
group by r.user_id
on conflict (kind, ref_id) do nothing;

insert into public.product_events (user_id, kind, platform, paid, ref_id, at)
select a.user_id, 'approve', nullif(lower(regexp_replace(coalesce(a.snapshot->>'platform', ''), '[^A-Za-z_]', '', 'g')), ''),
  public.cmo_paid(a.user_id), a.id, coalesce(a.decided_at, a.created_at)
from public.approvals a
where a.kind in ('post', 'reply') and a.status in ('approved', 'edited')
on conflict (kind, ref_id) do nothing;
