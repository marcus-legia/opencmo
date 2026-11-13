-- Autopilot's off switch on the top bar (owner, 2026-11-13).
--
-- Autopilot could already be turned off per platform in Settings, but that forgets which platforms were on, and the
-- only way to stop everything at once was Pause CMO, which also stops drafting. The founder now has one switch that
-- stops every countdown and keeps their choices: off, every post waits for their Approve again; on, new drafts count
-- down as before. A card that lost its countdown keeps waiting: nothing goes back on a countdown behind their back.
--
-- The rule lives in two functions, `post_autopilot_at` (when a card is raised) and `post_autopilot_still_on` (when
-- the hourly cron approves). Both are redeclared from their bodies in 20270119010000 with one added condition.

alter table public.profiles add column if not exists autopilot_paused boolean not null default false;

create or replace function public.post_autopilot_at(p_user uuid, p_ref_kind text, p_ref_id uuid, p_snapshot jsonb)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_p jsonb := p_snapshot->'proposed';
  v_profile public.profiles;
  v_item public.content_items;
  v_at timestamptz;
  v_auto timestamptz;
begin
  if p_snapshot->>'kind' is distinct from 'post' or p_ref_kind <> 'content_item' or p_snapshot ? 'thread'
     or v_p is null or v_p->>'mode' is distinct from 'publish' then
    return null;
  end if;
  select * into v_profile from public.profiles where id = p_user;
  if not found or v_profile.cmo_paused_at is not null or v_profile.autopilot_paused
     or v_profile.plan not in ('starter', 'creator')
     or not (v_p->>'platform' = any (v_profile.autopilot_platforms)) then
    return null;
  end if;
  select * into v_item from public.content_items where id = p_ref_id and user_id = p_user and department = 'post';
  -- A brief the founder wrote in the chat is theirs to read before it goes out.
  if not found or v_item.status <> 'in_review' or v_item.body->>'source' = 'cmo_chat' then
    return null;
  end if;
  if not exists (select 1 from public.social_accounts a
                 where a.user_id = p_user and a.platform = v_p->>'platform' and a.status = 'connected'
                   and a.id::text = v_p->>'account_id') then
    return null;
  end if;
  begin
    v_at := (v_p->>'at')::timestamptz;
  exception when others then
    return null;
  end;
  -- Approved a quarter of an hour before its time at the latest, so the slot is waiting when the sweep looks.
  v_auto := least(now() + make_interval(hours => v_profile.autopilot_hours), v_at - interval '15 minutes');
  if v_auto < now() + public.autopilot_min_window() then
    return null;
  end if;
  return v_auto;
end;
$$;

create or replace function public.post_autopilot_still_on(p_card public.approvals)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_card.kind = 'post' and p_card.ref_kind = 'content_item' and not (p_card.snapshot ? 'thread')
    and p_card.snapshot->'proposed'->>'mode' = 'publish'
    and exists (select 1 from public.profiles p
                where p.id = p_card.user_id and p.cmo_paused_at is null and not p.autopilot_paused
                  and p.plan in ('starter', 'creator')
                  and p_card.snapshot->'proposed'->>'platform' = any (p.autopilot_platforms))
    and exists (select 1 from public.content_items c
                where c.id = p_card.ref_id and c.user_id = p_card.user_id and c.status = 'in_review'
                  and c.body->>'source' is distinct from 'cmo_chat')
    and exists (select 1 from public.social_accounts a
                where a.user_id = p_card.user_id and a.status = 'connected'
                  and a.platform = p_card.snapshot->'proposed'->>'platform'
                  and a.id::text = p_card.snapshot->'proposed'->>'account_id');
$$;

-- The top bar's switch. No plan check: turning something off is never refused, and turning it back on changes
-- nothing for an account that has no platform chosen (`save_autopilot` holds those rules).
create or replace function public.set_autopilot_paused(p_paused boolean)
returns table (autopilot_platforms text[], autopilot_hours smallint, autopilot_note text, autopilot_paused boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  if p_paused is null then
    raise exception 'Say whether autopilot is on or off.' using errcode = '22023';
  end if;
  update public.profiles p set autopilot_paused = p_paused where p.id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  if p_paused then
    update public.approvals a set auto_at = null
    where a.user_id = v_user and a.status in ('waiting', 'held') and a.auto_at is not null;
  end if;
  return query
    select p.autopilot_platforms, p.autopilot_hours, p.autopilot_note, p.autopilot_paused
    from public.profiles p where p.id = v_user;
end;
$$;

revoke all on function public.set_autopilot_paused(boolean) from public, anon;
grant execute on function public.set_autopilot_paused(boolean) to authenticated;
