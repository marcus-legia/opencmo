-- Autopilot narrowed back to what CLAUDE.md allows (2026-11-13 database review). Each case below let a post go out
-- without the founder's Approve when the rule says they must see it first.
--
-- 1. A founder's own brief lost its marker. cmo_save_draft replaced the whole body, so `source = 'cmo_chat'` from
--    cmo_add_item was gone by the time the card was raised; and a "write it now" brief (the run's input.idea) never
--    had one. Now the marker survives the draft, and a run that carries the founder's idea sets it. Built on the
--    versions of 20270120020000 (targets, slot) and 20270120025000 (Threads chains), which it keeps.
-- 2. A held card got its countdown when it was inserted, out of the founder's sight. When it was released the next
--    day, auto_at had often passed, and the same cron call approved it. The countdown now starts when the card
--    becomes visible (inserted waiting, or released from held), from post_autopilot_at as before.
-- 3. A banned or deleted account kept its autopilot. The sweep now asks auth.users, as api_key_owner does.

create or replace function public.cmo_save_draft(p_user uuid, p_run uuid, p_item uuid, p_idea text, p_body jsonb,
  p_priority text default 'medium'::text, p_platform text default null::text)
returns public.content_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.content_items;
  v_profile jsonb := public.platform_profile(public.platform_profile_id(p_platform));
  v_post boolean := coalesce(v_profile->>'kind' = 'post', false);
  v_platform text := case when v_post then v_profile->>'label' else 'x' end;
  v_founder_brief boolean;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' or coalesce(p_body->>'text', '') = '' then
    raise exception 'This draft is not valid.' using errcode = '22023';
  end if;
  if p_body ? 'thread' then
    if not public.thread_valid(p_body) then
      raise exception 'A thread has 5 to 8 posts of at most 280 characters, the first being the post.' using errcode = '22023';
    end if;
    if coalesce(public.platform_profile_id(case when p_item is not null
         then (select platform from public.content_items where id = p_item and user_id = p_user) else v_platform end), 'x') <> 'x' then
      raise exception 'Only an X post can be a thread.' using errcode = '22023';
    end if;
  end if;
  if p_item is not null then
    update public.content_items
    set status = 'in_review',
        -- The right side reads the row before the update: the planner's targets and slot (20270120020000) and a
        -- founder's brief marker survive the draft.
        body = (p_body - 'targets' - 'slot' - 'source')
          || jsonb_strip_nulls(jsonb_build_object('targets', body->'targets', 'slot', body->'slot',
               'source', case when body->>'source' = 'cmo_chat' then 'cmo_chat' end)),
        priority = coalesce(p_priority, 'medium'), run_id = p_run, updated_at = now()
    where id = p_item and user_id = p_user and status in ('planned', 'drafting')
    returning * into v_row;
    if not found then
      raise exception 'This calendar item is no longer open.' using errcode = 'P0002';
    end if;
  else
    -- No calendar item: the brief came from the run. An idea in its input is the founder's own words.
    v_founder_brief := exists (select 1 from public.cmo_runs r
                               where r.id = p_run and r.user_id = p_user and coalesce(r.input->>'idea', '') <> '');
    insert into public.content_items (user_id, run_id, department, platform, day, idea, status, priority, body)
    values (p_user, p_run, 'post', v_platform, current_date,
            left(coalesce(nullif(p_idea, ''), 'Post for ' || case when v_post then v_profile->>'label' else 'X' end), 300),
            'in_review', coalesce(p_priority, 'medium'),
            (p_body - 'targets' - 'slot' - 'source')
              || case when v_founder_brief then jsonb_build_object('source', 'cmo_chat') else '{}'::jsonb end)
    returning * into v_row;
  end if;
  return v_row;
end;
$function$;

create or replace function public.approvals_autopilot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and not (old.status = 'held' and new.status = 'waiting') then
    return new;
  end if;
  new.auto_at := null;
  -- The countdown starts when the founder can see the card, never while it is held.
  if new.kind = 'post' and new.status = 'waiting' then
    begin
      new.auto_at := public.post_autopilot_at(new.user_id, new.ref_kind, new.ref_id, new.snapshot);
      -- A Threads chain is a thread and stays out of autopilot (20270120025000).
      if new.auto_at is not null and public.post_is_threads_chain(new.ref_id, new.snapshot) then
        new.auto_at := null;
      end if;
    exception when others then
      -- The card matters more than its countdown: it is raised as an ordinary card.
      raise warning 'autopilot for card of % failed: %', new.ref_id, sqlerrm;
      new.auto_at := null;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists approvals_autopilot on public.approvals;
create trigger approvals_autopilot before insert or update of status on public.approvals
  for each row execute function public.approvals_autopilot();

-- Cards already held carry a countdown from before this fix; they get a fresh one when released.
update public.approvals set auto_at = null where status = 'held' and auto_at is not null;

create or replace function public.post_autopilot_still_on(p_card public.approvals)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p_card.kind = 'post' and p_card.ref_kind = 'content_item' and not (p_card.snapshot ? 'thread')
    and p_card.snapshot->'proposed'->>'mode' = 'publish'
    and exists (select 1 from auth.users u
                where u.id = p_card.user_id and u.deleted_at is null
                  and (u.banned_until is null or u.banned_until <= now()))
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
$function$;
