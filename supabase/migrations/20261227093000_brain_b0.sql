-- 20261227090000: brain B0, corrections and budget (docs/architecture/brain.md §8, §9; brain plan W1-1).
--
-- Corrections are memory tier 0: short rules learned from the founder's edits and skip reasons, read first by
-- every job. The brain only proposes one; it becomes a rule after the founder approves its card, and the founder
-- can retire it later. Rows are never deleted, so the log keeps where each rule came from.
--
-- The weekly credit budget, time zone and digest hour are the founder's settings for the brain (Settings page).
-- They are read by the order tree (B1) and the progress check and digest (B2); nothing spends against them here.

begin;

create table public.cmo_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule text not null check (char_length(rule) between 3 and 200),
  -- The edits the rule was learned from: [{before, after, at}]. Shown on the correction card.
  source_edits jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_edits) = 'array' and octet_length(source_edits::text) <= 8192),
  status text not null default 'proposed' check (status in ('proposed', 'active', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index cmo_corrections_user_idx on public.cmo_corrections (user_id, status, created_at desc);
alter table public.cmo_corrections enable row level security;
create policy "read own corrections" on public.cmo_corrections
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.cmo_corrections from anon, authenticated;
grant select on public.cmo_corrections to authenticated;
grant select, insert, update, delete on public.cmo_corrections to service_role;

-- The brain proposes (Sunday summary, service role). The same rule twice is one row; at most five proposals wait
-- at a time, so the founder is never handed a pile of rule cards.
create or replace function public.cmo_propose_correction(p_user uuid, p_rule text, p_source_edits jsonb default '[]'::jsonb)
returns public.cmo_corrections language plpgsql volatile security definer set search_path = public
as $$
declare
  v_rule text := trim(coalesce(p_rule, ''));
  v_row public.cmo_corrections;
begin
  if char_length(v_rule) < 3 or char_length(v_rule) > 200 then
    raise exception 'Write the rule in 3 to 200 characters.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cmo_corrections:' || p_user::text, 0));
  select * into v_row from public.cmo_corrections
  where user_id = p_user and status in ('proposed', 'active') and lower(rule) = lower(v_rule)
  limit 1;
  if found then
    return v_row;
  end if;
  if (select count(*) from public.cmo_corrections where user_id = p_user and status = 'proposed') >= 5 then
    raise exception 'Five rules already wait for a decision.' using errcode = 'P0001';
  end if;
  insert into public.cmo_corrections (user_id, rule, source_edits)
  values (p_user, v_rule, coalesce(p_source_edits, '[]'::jsonb))
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.cmo_propose_correction(uuid, text, jsonb) from public, anon, authenticated;

-- The founder decides a proposed rule (approve, edit then keep, reject) or retires an active one (reject).
create or replace function public.cmo_decide_correction(p_id uuid, p_action text, p_text text default null)
returns public.cmo_corrections language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.cmo_corrections;
  v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if p_action is null or p_action not in ('approve', 'edit', 'reject') then
    raise exception 'Choose approve, edit or reject.' using errcode = '22023';
  end if;
  if p_action = 'edit' and (v_text is null or char_length(v_text) < 3 or char_length(v_text) > 200) then
    raise exception 'Write the rule in 3 to 200 characters.' using errcode = '22023';
  end if;
  select * into v_row from public.cmo_corrections where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Rule not found.' using errcode = 'P0002';
  end if;
  if v_row.status = 'rejected' or (v_row.status = 'active' and p_action <> 'reject') then
    raise exception 'This rule was already decided.' using errcode = 'P0001';
  end if;
  update public.cmo_corrections
  set status = case p_action when 'reject' then 'rejected' else 'active' end,
      rule = case p_action when 'edit' then v_text else rule end,
      decided_at = now()
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.cmo_decide_correction(uuid, text, text) from public, anon;
grant execute on function public.cmo_decide_correction(uuid, text, text) to authenticated;

-- Settings. The budget default is the frames' sample week until B1 measures credits per approved deliverable
-- (brain.md §12, decision 2). Null digest hour = no digest.
alter table public.profiles
  add column weekly_credit_budget integer not null default 80 check (weekly_credit_budget between 0 and 10000),
  add column timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  add column digest_hour smallint default 7 check (digest_hour between 0 and 23);

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
  set weekly_credit_budget = p_weekly_credit_budget, timezone = p_timezone, digest_hour = p_digest_hour
  where p.id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  return query select p.weekly_credit_budget, p.timezone, p.digest_hour from public.profiles p where p.id = v_user;
end;
$$;
revoke all on function public.save_cmo_settings(integer, text, smallint) from public, anon;
grant execute on function public.save_cmo_settings(integer, text, smallint) to authenticated;

commit;
