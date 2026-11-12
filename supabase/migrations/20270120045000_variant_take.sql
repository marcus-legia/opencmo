-- A slot that posts a rewrite never rides on the post card's approval (daily core drafts D4, 2026-11-12).
--
-- The post card shows and approves the core text and its time for the first target. When the founder had the post
-- rewritten for that platform, the slot there posts the rewrite, which the post card did not show: it gets its own
-- schedule card with the rewrite on it. Redeclares `schedule_take_proposal` of 20270113010000; the grants are kept.

create or replace function public.schedule_take_proposal(p_d public.deliverables, p_platform text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rules jsonb := public.schedule_rules();
  v_item public.content_items;
  v_p jsonb;
  v_at timestamptz;
  v_gap interval := make_interval(hours => (v_rules->>'minGapHours')::integer);
  v_slot public.schedule_slots;
  v_snapshot jsonb;
  v_id uuid;
  v_gone constant text := 'The time you approved is no longer free. Pick a new one.';
begin
  -- "I posted it" approves and marks the post posted at once: nothing is scheduled for it.
  if coalesce(current_setting('opencmo.posted_self', true), '') = 'on' then
    return 'none';
  end if;
  -- A rewrite for this platform was not on the post card (daily core drafts D4): the founder sees it on its own
  -- schedule card before it goes out, so this slot does not ride on the post's approval.
  if public.post_variant_text(p_d.ref_id, p_platform) is not null then
    return 'none';
  end if;
  -- The approved time is used once, for the post's first slot on the platform; a slot asked again later (missed,
  -- expired, a Retry past its window) gets a new time on a card, as before.
  if exists (select 1 from public.schedule_slots where deliverable_id = p_d.id and platform = p_platform) then
    return 'none';
  end if;
  select * into v_item from public.content_items where id = p_d.ref_id and user_id = p_d.user_id and status = 'approved';
  if not found then
    return 'none';
  end if;
  v_p := public.post_proposal_snapshot(v_item.body);
  if v_p is null or v_p->>'platform' is distinct from p_platform then
    return 'none';
  end if;
  v_at := (v_p->>'at')::timestamptz;
  if v_at < now() + interval '1 minute' then
    return 'The time you approved has passed. Pick a new one.';
  end if;
  -- The founder's own pick is kept next to another post (`schedule_change` keeps it too); the picked one is not.
  if (v_item.body->'proposed'->>'picked' is distinct from 'founder' and exists (select 1 from public.schedule_slots
        where user_id = p_d.user_id and platform = p_platform and deliverable_id <> p_d.id
          and status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published')
          and publish_at > v_at - v_gap and publish_at < v_at + v_gap))
     or public.schedule_day_count(p_d.user_id, p_platform, v_at, null)
        >= (v_rules->'platforms'->p_platform->>'dailyCap')::integer then
    return v_gone;
  end if;
  -- Copy and open was approved, but an account is connected now: the founder decides again with the account.
  if v_p->>'mode' = 'intent' and exists (select 1 from public.social_accounts
      where user_id = p_d.user_id and platform = p_platform and status = 'connected') then
    return 'You connected ' || public.schedule_platform_label(p_platform) || ' since you approved it. Check the time and the account.';
  end if;
  v_slot.user_id := p_d.user_id;
  v_slot.deliverable_id := p_d.id;
  v_slot.platform := p_platform;
  v_slot.mode := v_p->>'mode';
  v_slot.account_id := case when v_slot.mode = 'publish' then (v_p->>'account_id')::uuid end;
  v_slot.options := '{}'::jsonb;
  if v_slot.mode = 'publish' and not exists (select 1 from public.social_accounts
      where id = v_slot.account_id and user_id = p_d.user_id and platform = p_platform) then
    return 'Reconnect your ' || public.schedule_platform_label(p_platform) || ' account first.';
  end if;
  begin
    perform public.schedule_ready_check(v_slot);
  exception when others then
    -- Its own words ("Reconnect your Threads account first."): the card shows why, not a time that is taken.
    return left(sqlerrm, 300);
  end;
  begin
    insert into public.schedule_slots (user_id, deliverable_id, platform, account_id, mode, publish_at, jitter_seconds,
      window_ends_at, options, status)
    values (v_slot.user_id, v_slot.deliverable_id, p_platform, v_slot.account_id, v_slot.mode, v_at, public.schedule_jitter(),
      v_at + make_interval(mins => (v_rules->>'windowMinutes')::integer), v_slot.options, 'waiting')
    returning * into v_slot;
  exception when unique_violation then
    return v_gone;
  end;
  -- The approval the firing checks (`schedule_approval_holds`): the slot as it is now, decided with the post card.
  v_snapshot := public.approval_snapshot('schedule_slot', v_slot.id);
  insert into public.approvals (user_id, kind, department, ref_kind, ref_id, snapshot, content_hash, post_at, account,
    status, decided_at, decided_via)
  values (v_slot.user_id, 'schedule', 'schedule', 'schedule_slot', v_slot.id, v_snapshot, public.approval_hash(v_snapshot),
    v_at, left(v_snapshot->>'handle', 100), 'approved', now(),
    coalesce(nullif(current_setting('opencmo.decided_via', true), ''), 'app'))
  returning id into v_id;
  update public.schedule_slots set approval_id = v_id, updated_at = now() where id = v_slot.id;
  return 'taken';
end;
$$;
