-- 20261230140000: P4, finishing the phase after sessions A and B stopped (docs/plans/cmo/2026-10-28-p4-sessions/,
-- requests C7 and C8).
--
-- - A due slot with no connected account used to turn `reminded` and show nothing. It now raises its copy-and-open
--   card (as publish_status 'intent' does), and that card does not expire: the founder posts it when they can.
-- - schedule_propose read a post's platform as an id, but Writer stores the calendar's label ("X", "Threads",
--   "LinkedIn"): no real post ever got a slot. It now goes through platform_profile_id.
-- - schedule_mark_posted: the founder copied it and posted it themselves. The slot is published, its card closed,
--   and a post's row is published too (its other waiting slots are dropped by schedule_follow_content).

begin;

create or replace function public.schedule_claim_due()
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  v_slot public.schedule_slots;
  v_root public.work_orders;
  v_order public.work_orders;
  v_missed integer := 0;
  v_fired integer := 0;
  v_reminded integer := 0;
  v_failed integer := 0;
  v_unconfirmed integer := 0;
begin
  -- Never late: past its window, a slot that has not started posting is missed.
  for v_slot in
    select s.* from public.schedule_slots s
    where s.status in ('proposed', 'waiting', 'due') and s.window_ends_at <= now() and not public.cmo_paused(s.user_id)
    order by s.publish_at limit 200
    for update skip locked
  loop
    perform public.schedule_miss(v_slot, case when v_slot.status = 'proposed' then null
      else 'It could not go out within its time window.' end);
    v_missed := v_missed + 1;
  end loop;

  for v_slot in
    select s.* from public.schedule_slots s
    where s.status = 'waiting' and s.publish_at + make_interval(secs => s.jitter_seconds) <= now()
      and now() < s.window_ends_at and not public.cmo_paused(s.user_id)
    order by s.publish_at limit 100
    for update skip locked
  loop
    -- Approved, then changed (the words, the video, the account): never post what the founder did not see.
    if not public.schedule_approval_holds(v_slot) then
      perform public.schedule_miss(v_slot, 'It changed after you approved it.');
      v_missed := v_missed + 1;
      continue;
    end if;
    -- No connected account: the founder posts it. Their card (copy and open, "I posted it") comes now and waits for
    -- them, unlike a time card: the words are theirs to post whenever they get to it.
    if v_slot.mode = 'intent' then
      perform public.publish_status(v_slot.id, 'intent');
      update public.approvals set expires_at = null
      where ref_kind = 'schedule_slot' and ref_id = v_slot.id and status = 'waiting';
      v_reminded := v_reminded + 1;
      continue;
    end if;
    begin
      v_root := public.work_order_week_root(v_slot.user_id);
      v_order := public.work_order_create(v_slot.user_id, v_root.week, v_root.id, 'publish_post',
        'Post on ' || public.schedule_platform_label(v_slot.platform),
        jsonb_build_object('objective', 'Post the approved ' || public.schedule_platform_label(v_slot.platform) || ' post at its time.',
          'slot_id', v_slot.id),
        0, v_slot.window_ends_at, '{}', 'event', null, 'publish');
      perform public.cmo_enqueue(v_slot.user_id, 'publish_post',
        jsonb_build_object('slot_id', v_slot.id, 'order_id', v_order.id, 'source', 'event'));
      -- The lease lasts as long as the window: nothing else claims it, and it never fires after.
      update public.schedule_slots set status = 'due', lease_until = window_ends_at, updated_at = now() where id = v_slot.id;
      v_fired := v_fired + 1;
    exception when others then
      update public.schedule_slots
      set status = 'failed', updated_at = now(),
          error = jsonb_build_object('code', 'not_started', 'message', left('It could not start: ' || sqlerrm, 500))
      where id = v_slot.id;
      perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
      v_failed := v_failed + 1;
    end;
  end loop;

  -- Zernio took a post but never confirmed it an hour after its window: say so, and never post it again by ourselves.
  update public.schedule_slots
  set status = 'failed', lease_until = null, updated_at = now(),
      error = jsonb_build_object('code', 'unconfirmed',
        'message', 'We could not confirm it went out. Check your account before posting it again.')
  where status = 'publishing' and window_ends_at + interval '1 hour' <= now();
  get diagnostics v_unconfirmed = row_count;

  return jsonb_build_object('fired', v_fired, 'reminded', v_reminded, 'missed', v_missed, 'failed', v_failed,
    'unconfirmed', v_unconfirmed);
end;
$$;
revoke all on function public.schedule_claim_due() from public, anon, authenticated;
grant execute on function public.schedule_claim_due() to service_role;

create or replace function public.schedule_propose(p_deliverable uuid)
returns integer language plpgsql volatile security definer set search_path = public
as $$
declare
  v_d public.deliverables;
  v_rules jsonb := public.schedule_rules();
  v_platform text;
  v_platforms text[];
  v_at timestamptz;
  v_account uuid;
  v_slot uuid;
  v_n integer := 0;
begin
  select * into v_d from public.deliverables where id = p_deliverable;
  if not found then
    return 0;
  end if;
  if v_d.kind = 'post' and v_d.ref_kind = 'content_item' then
    -- Writer stores the calendar's label ("X", "Threads", "LinkedIn"); slots use the platform's id.
    select array_agg(public.platform_profile_id(platform)) into v_platforms from public.content_items
    where id = v_d.ref_id and status = 'approved' and public.platform_profile_id(platform) in ('x', 'threads', 'linkedin');
  elsif v_d.kind = 'short' and v_d.ref_kind = 'clip' then
    select array_agg(p) into v_platforms from unnest(array['tiktok', 'instagram', 'youtube']) p
    where exists (select 1 from public.content_items c
      where c.clip_id = v_d.ref_id and c.department = 'video' and c.status = 'approved'
        and c.platform = public.platform_profile_id(p));
  end if;
  foreach v_platform in array coalesce(v_platforms, '{}') loop
    continue when exists (select 1 from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform
      and status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published'));
    continue when (select count(*) from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform)
      >= (v_rules->>'maxProposals')::integer;
    v_at := public.schedule_pick_time(v_d.user_id, v_platform, v_d.id);
    continue when v_at is null;
    select id into v_account from public.social_accounts
    where user_id = v_d.user_id and platform = v_platform and status = 'connected';
    -- TikTok's posting guidelines: the founder picks the audience and turns on each interaction and disclosure;
    -- nothing starts on.
    insert into public.schedule_slots (user_id, deliverable_id, platform, account_id, mode, publish_at, jitter_seconds,
      window_ends_at, options)
    values (v_d.user_id, v_d.id, v_platform, v_account, case when v_account is null then 'intent' else 'publish' end,
      v_at, public.schedule_jitter(), v_at + make_interval(mins => (v_rules->>'windowMinutes')::integer),
      case when v_platform = 'tiktok' then '{"allow_comment": false, "allow_duet": false, "allow_stitch": false,
        "brand_organic": false, "brand_content": false}'::jsonb else '{}'::jsonb end)
    returning id into v_slot;
    perform public.approval_raise(v_d.user_id, 'schedule_slot', v_slot);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.schedule_propose(uuid) from public, anon, authenticated;

-- "I posted it" on a copy-and-open card. Only the founder's own slot, and only one they post themselves: a slot
-- that goes through their connected account is never marked posted by hand. A second call changes nothing.
create or replace function public.schedule_mark_posted(p_slot uuid)
returns public.approvals language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_slot public.schedule_slots;
  v_d public.deliverables;
  v_row public.approvals;
begin
  select * into v_slot from public.schedule_slots where id = p_slot and user_id = v_user for update;
  if not found then
    raise exception 'Slot not found.' using errcode = 'P0002';
  end if;
  if v_slot.status <> 'published' then
    if v_slot.mode <> 'intent' or v_slot.status not in ('failed', 'reminded') then
      raise exception 'Only a post you copy and post yourself can be marked as posted.' using errcode = 'P0001';
    end if;
    update public.schedule_slots
    set status = 'published', published_at = now(), lease_until = null, error = null, updated_at = now()
    where id = v_slot.id;
    perform public.approval_close('schedule_slot', v_slot.id, 'approved');
    select * into v_d from public.deliverables where id = v_slot.deliverable_id;
    if v_d.ref_kind = 'content_item' then
      update public.content_items set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
      where id = v_d.ref_id and user_id = v_user and status <> 'published';
    end if;
  end if;
  select * into v_row from public.approvals
  where ref_kind = 'schedule_slot' and ref_id = v_slot.id order by created_at desc limit 1;
  return v_row;
end;
$$;
revoke all on function public.schedule_mark_posted(uuid) from public, anon, authenticated;
grant execute on function public.schedule_mark_posted(uuid) to authenticated;

commit;
