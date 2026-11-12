-- Autopilot for posts (owner, 2026-11-12): a post goes out without the founder's Approve, after a review window.
--
-- Until now every post waited for an Approve. On the owner's own account drafts waited a month for it, so the loop
-- produced cards and nothing went out. A founder may now turn this on per platform, for posts only, on an account
-- they connected: the draft's card says when it goes out, the founder can edit or skip it until then, and an
-- untouched card is approved for them at that time. Off by default.
--
-- What never goes out on its own: Reddit replies (Sales has no post button), threads, a post the founder briefed
-- themselves in the chat, anything on a platform without a connected account, and anything while the CMO is paused.
--
-- The approval itself is not a second code path: `approval_auto_decide` calls `approval_decide` as the card's owner,
-- so the content hash, the daily cap of five approvals a platform, the slot and the work order behave as they do
-- when the founder presses Approve.

alter table public.profiles
  add column if not exists autopilot_platforms text[] not null default '{}',
  add column if not exists autopilot_hours smallint not null default 12,
  add column if not exists autopilot_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_autopilot_platforms_check') then
    alter table public.profiles
      add constraint profiles_autopilot_platforms_check check (autopilot_platforms <@ array['x', 'threads', 'linkedin']::text[]),
      add constraint profiles_autopilot_hours_check check (autopilot_hours in (6, 12, 24)),
      add constraint profiles_autopilot_note_check check (char_length(autopilot_note) <= 200);
  end if;
end $$;

alter table public.approvals add column if not exists auto_at timestamptz;
alter table public.approvals drop constraint if exists approvals_decided_via_check;
alter table public.approvals add constraint approvals_decided_via_check
  check (decided_via = any (array['app', 'email', 'push', 'mcp', 'auto']));
create index if not exists approvals_auto_idx on public.approvals (auto_at) where status = 'waiting' and auto_at is not null;

-- A decision nobody made says nothing about the founder's taste: Writer's voice and the approval numbers leave it out.
alter table public.cmo_draft_outcomes add column if not exists auto boolean not null default false;

-- The shortest window a card is given. A post due sooner keeps its ordinary card: there is no time to look at it.
create or replace function public.autopilot_min_window() returns interval
language sql immutable as $$ select interval '1 hour' $$;

-- When a post card goes out on its own, or null when it waits for the founder like any other card.
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
  if not found or v_profile.cmo_paused_at is not null or v_profile.plan not in ('starter', 'creator')
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

create or replace function public.approvals_autopilot() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'post' and new.status in ('waiting', 'held') then
    begin
      new.auto_at := public.post_autopilot_at(new.user_id, new.ref_kind, new.ref_id, new.snapshot);
    exception when others then
      -- The card matters more than its countdown: it is raised as an ordinary card.
      raise warning 'autopilot for card of % failed: %', new.ref_id, sqlerrm;
      new.auto_at := null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists approvals_autopilot on public.approvals;
create trigger approvals_autopilot before insert on public.approvals
  for each row execute function public.approvals_autopilot();

-- Three autopilot posts skipped in a row on a platform: the drafts are not good enough to go out unread, so it turns
-- itself off there and says why in Settings.
create or replace function public.approvals_autopilot_skips() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_platform text := new.snapshot->'proposed'->>'platform';
begin
  if new.status <> 'skipped' or old.status = 'skipped' or old.auto_at is null or v_platform is null then
    return new;
  end if;
  if (select count(*) filter (where a.status = 'skipped') = 3
      from (select status from public.approvals
            where user_id = new.user_id and kind = 'post' and auto_at is not null
              and snapshot->'proposed'->>'platform' = v_platform and status in ('approved', 'edited', 'skipped')
            order by decided_at desc nulls last limit 3) a) then
    update public.profiles
    set autopilot_platforms = array_remove(autopilot_platforms, v_platform),
        autopilot_note = 'Turned off for ' || public.schedule_platform_label(v_platform) || ' after you skipped three posts in a row.'
    where id = new.user_id and v_platform = any (autopilot_platforms);
    update public.approvals set auto_at = null
    where user_id = new.user_id and status in ('waiting', 'held') and auto_at is not null
      and snapshot->'proposed'->>'platform' = v_platform;
  end if;
  return new;
end;
$$;

drop trigger if exists approvals_autopilot_skips on public.approvals;
create trigger approvals_autopilot_skips after update of status on public.approvals
  for each row execute function public.approvals_autopilot_skips();

-- The founder's switch (Settings → Your CMO). Turning a platform off stops the cards already counting down.
create or replace function public.save_autopilot(p_platforms text[], p_hours smallint)
returns table (autopilot_platforms text[], autopilot_hours smallint, autopilot_note text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_platforms text[] := coalesce((select array_agg(distinct p order by p) from unnest(coalesce(p_platforms, '{}')) p), '{}');
  v_platform text;
begin
  if p_hours is null or p_hours not in (6, 12, 24) then
    raise exception 'Choose 6, 12 or 24 hours.' using errcode = '22023';
  end if;
  if not (v_platforms <@ array['x', 'threads', 'linkedin']::text[]) then
    raise exception 'Posts go out on their own on X, Threads and LinkedIn only.' using errcode = '22023';
  end if;
  if cardinality(v_platforms) > 0 and coalesce((select plan not in ('starter', 'creator') from public.profiles where id = v_user), true) then
    perform public.cmo_plan_required();
  end if;
  foreach v_platform in array v_platforms loop
    if not exists (select 1 from public.social_accounts a
                   where a.user_id = v_user and a.platform = v_platform and a.status = 'connected') then
      raise exception 'Connect your % account first.', public.schedule_platform_label(v_platform) using errcode = 'P0001';
    end if;
  end loop;
  update public.profiles p
  set autopilot_platforms = v_platforms, autopilot_hours = p_hours, autopilot_note = null
  where p.id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  update public.approvals a set auto_at = null
  where a.user_id = v_user and a.status in ('waiting', 'held') and a.auto_at is not null
    and not (a.snapshot->'proposed'->>'platform' = any (v_platforms));
  return query select p.autopilot_platforms, p.autopilot_hours, p.autopilot_note from public.profiles p where p.id = v_user;
end;
$$;

-- Writer's voice is learned from what the founder decided. An approval made for them teaches nothing.
create or replace function public.cmo_draft_outcomes_learn() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.edit_mode is null or (tg_op = 'UPDATE' and old.edit_mode is not distinct from new.edit_mode) then
    return new;
  end if;
  if coalesce(current_setting('opencmo.autopilot', true), '') = 'on' or new.auto then
    return new;
  end if;
  begin
    perform public.voice_note_write(new.id);
    perform public.correction_from_edits(new.id);
  exception when others then
    raise warning 'learning from decision % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- Everything `post_autopilot_at` asks except the time left: the switch, the plan, the pause, the account, the brief.
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
                where p.id = p_card.user_id and p.cmo_paused_at is null and p.plan in ('starter', 'creator')
                  and p_card.snapshot->'proposed'->>'platform' = any (p.autopilot_platforms))
    and exists (select 1 from public.content_items c
                where c.id = p_card.ref_id and c.user_id = p_card.user_id and c.status = 'in_review'
                  and c.body->>'source' is distinct from 'cmo_chat')
    and exists (select 1 from public.social_accounts a
                where a.user_id = p_card.user_id and a.status = 'connected'
                  and a.platform = p_card.snapshot->'proposed'->>'platform'
                  and a.id::text = p_card.snapshot->'proposed'->>'account_id');
$$;

-- Approves the cards whose window is over, each as its owner and through `approval_decide`. Called by the hourly
-- cron with the service role. A card that cannot be approved (the daily cap, a changed draft, an account that was
-- disconnected) loses its countdown and waits for the founder like any other.
create or replace function public.approval_auto_decide(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.approvals;
  v_count integer := 0;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Invalid batch size.' using errcode = '22023';
  end if;
  for v_card in
    select * from public.approvals
    where status = 'waiting' and kind = 'post' and auto_at is not null and auto_at <= now()
    order by auto_at
    limit p_limit
    for update skip locked
  loop
    begin
      -- Asked again now: the switch, the plan, the pause and the account may have changed since the card was raised.
      if not public.post_autopilot_still_on(v_card) then
        update public.approvals set auto_at = null where id = v_card.id;
        continue;
      end if;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_card.user_id, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_card.user_id::text, true);
      perform set_config('opencmo.autopilot', 'on', true);
      perform public.approval_decide(v_card.id, 'approve', jsonb_build_object('content_hash', v_card.content_hash, 'via', 'app'));
      update public.approvals set decided_via = 'auto' where id = v_card.id;
      update public.cmo_draft_outcomes set auto = true where department = 'post' and item_id = v_card.ref_id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'autopilot could not approve card %: %', v_card.id, sqlerrm;
      update public.approvals set auto_at = null where id = v_card.id;
    end;
  end loop;
  perform set_config('opencmo.autopilot', '', true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_count;
end;
$$;

revoke all on function public.autopilot_min_window() from public, anon, authenticated;
revoke all on function public.post_autopilot_at(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.post_autopilot_still_on(public.approvals) from public, anon, authenticated;
revoke all on function public.approval_auto_decide(integer) from public, anon, authenticated;
revoke all on function public.approvals_autopilot() from public, anon, authenticated;
revoke all on function public.approvals_autopilot_skips() from public, anon, authenticated;
revoke all on function public.save_autopilot(text[], smallint) from public, anon;
grant execute on function public.approval_auto_decide(integer) to service_role;
grant execute on function public.save_autopilot(text[], smallint) to authenticated;
