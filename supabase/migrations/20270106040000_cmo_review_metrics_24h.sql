-- cmo-review B2.4: a post's numbers are read 24 hours after it went out.
--
-- `pull_metrics` ran only as the daily loop, so a post published at 01:00 was first measured almost two days later,
-- and the "posted → measure" event rule of workflow.md §4 did not exist. Modal's per-minute sweep already calls
-- `schedule_claim_due`; it now also queues one pull_metrics run per founder whose post turned 24 hours old. The daily
-- loop stays as the catch-all.

CREATE OR REPLACE FUNCTION public.schedule_claim_due() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slot public.schedule_slots;
  v_root public.work_orders;
  v_order public.work_orders;
  v_missed integer := 0;
  v_fired integer := 0;
  v_reminded integer := 0;
  v_failed integer := 0;
  v_unconfirmed integer := 0;
  v_user uuid;
  v_measured integer := 0;
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
  -- Its card waits for the founder (no expiry): "It went out" or a new time, never a blind Retry.
  for v_slot in
    select s.* from public.schedule_slots s
    where s.status = 'publishing' and s.window_ends_at + interval '1 hour' <= now()
    for update skip locked
  loop
    update public.schedule_slots
    set status = 'failed', lease_until = null, updated_at = now(),
        error = jsonb_build_object('code', 'unconfirmed', 'retryable', false,
          'message', 'We could not confirm it went out. Check your account before posting it again.')
    where id = v_slot.id;
    perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
    update public.approvals set expires_at = null
    where ref_kind = 'schedule_slot' and ref_id = v_slot.id and status = 'waiting';
    v_unconfirmed := v_unconfirmed + 1;
  end loop;

  -- 24 hours after a post went out, its numbers are read (cmo-review B2.4): reply outcomes and post metrics land the
  -- day after, not at the next daily loop. Once per post: a pull_metrics run queued after that moment covers it, and
  -- cmo_enqueue merges a founder's posts into the run already waiting.
  for v_user in
    select distinct s.user_id from public.schedule_slots s
    where s.status = 'published' and s.published_at is not null
      and s.published_at between now() - interval '48 hours' and now() - interval '24 hours'
      and not public.cmo_paused(s.user_id)
      and not exists (select 1 from public.cmo_runs r where r.user_id = s.user_id and r.kind = 'pull_metrics'
                      and r.created_at >= s.published_at + interval '24 hours')
    limit 50
  loop
    begin
      perform public.cmo_enqueue(v_user, 'pull_metrics', jsonb_build_object('source', 'event'));
      v_measured := v_measured + 1;
    exception when others then
      -- The day's cap or a paused founder: the daily loop reads it instead.
      null;
    end;
  end loop;

  return jsonb_build_object('fired', v_fired, 'reminded', v_reminded, 'missed', v_missed, 'failed', v_failed,
    'unconfirmed', v_unconfirmed, 'measured', v_measured);
end;
$$;
