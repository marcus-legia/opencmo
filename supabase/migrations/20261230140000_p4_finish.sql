-- 20261230140000: P4, finishing the phase after sessions A and B stopped (docs/plans/cmo/2026-10-28-p4-sessions/,
-- requests C7 and C8).
--
-- - A due slot with no connected account used to turn `reminded` and show nothing. It now raises its copy-and-open
--   card (as publish_status 'intent' does), and that card does not expire: the founder posts it when they can.
-- - schedule_propose read a post's platform as an id, but Writer stores the calendar's label ("X", "Threads",
--   "LinkedIn"): no real post ever got a slot. It now goes through platform_profile_id.
-- - Review fixes: each attempt uploads again and posts with its own key; a disconnected account's slots ask again
--   as copy-and-open; a failed slot in its window (or unconfirmed) is not proposed twice; unconfirmed posts get a
--   card; a published post closes its Retry card; a `schedule` rate-limit bucket for the slot route.
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
    -- A failure still in its window waits on its Retry card; an unconfirmed one may have gone out. Neither gets a twin.
    continue when exists (select 1 from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform
      and status = 'failed' and (window_ends_at > now() or error->>'code' = 'unconfirmed'));
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
    -- A post the founder posted themselves, or one we could not confirm that they checked is live.
    if not ((v_slot.mode = 'intent' and v_slot.status in ('failed', 'reminded'))
            or (v_slot.status = 'failed' and v_slot.error->>'code' = 'unconfirmed')) then
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


-- Review fixes (code review of cmo-p4, 2026-10-30).

create or replace function public.publish_slot_start(p_slot uuid, p_user uuid, p_order uuid)
returns public.schedule_slots language plpgsql volatile security definer set search_path = public
as $$
declare
  v_slot public.schedule_slots := public.publish_slot_guard(p_slot, p_user, p_order);
begin
  if v_slot.status = 'publishing' then
    return v_slot;
  end if;
  if v_slot.status <> 'due' then
    raise exception 'This post is not due (it is %).', v_slot.status using errcode = 'P0001';
  end if;
  if now() >= v_slot.window_ends_at then
    raise exception 'This post missed its time window.' using errcode = 'P0001';
  end if;
  if public.cmo_paused(v_slot.user_id) then
    raise exception 'Your CMO is paused.' using errcode = 'P0001';
  end if;
  if not public.schedule_approval_holds(v_slot) then
    raise exception 'This post changed after it was approved.' using errcode = 'P0001';
  end if;
  -- A new attempt uploads again: the export of what is approved now, never an earlier attempt's file.
  update public.schedule_slots set status = 'publishing', attempts = attempts + 1, media_task_id = null, updated_at = now()
  where id = v_slot.id returning * into v_slot;
  return v_slot;
end;
$$;
revoke all on function public.publish_slot_start(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_slot_start(uuid, uuid, uuid) to service_role;

create or replace function public.publish_slot_read(p_slot uuid, p_user uuid, p_order uuid)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  v_slot public.schedule_slots := public.publish_slot_guard(p_slot, p_user, p_order);
  v_account public.social_accounts;
  v_approval public.approvals;
  v_current jsonb := public.schedule_content(v_slot.deliverable_id, v_slot.platform);
  v_export jsonb;
  v_task public.tasks;
  v_media jsonb := '{"state": "none"}'::jsonb;
begin
  select * into v_account from public.social_accounts where id = v_slot.account_id;
  select * into v_approval from public.approvals where id = v_slot.approval_id;
  if v_current->>'clip_id' is not null then
    select jsonb_build_object('object', t.output_path, 'bytes', t.bytes) into v_export
    from public.tasks t join public.editor_projects p on p.clip_id = t.clip_id
    where t.clip_id = (v_current->>'clip_id')::uuid and t.kind = 'render_document' and t.status = 'done'
      and t.settings_hash = public.editor_document_hash(p.document) and t.output_path is not null
    order by t.finished_at desc nulls last limit 1;
  end if;
  select * into v_task from public.tasks where id = v_slot.media_task_id;
  if v_task.id is not null then
    v_media := case v_task.status
      when 'done' then jsonb_build_object('state', 'done', 'publicUrl', v_task.payload->>'public_url', 'contentType', 'video/mp4')
      when 'failed' then jsonb_build_object('state', 'failed', 'error', coalesce(v_task.error, 'The video could not be uploaded.'))
      when 'cancelled' then jsonb_build_object('state', 'failed', 'error', 'The video upload was cancelled.')
      else jsonb_build_object('state', 'running', 'startedAt', to_jsonb(coalesce(v_task.started_at, v_task.created_at))) end;
  end if;
  return jsonb_build_object('id', v_slot.id, 'status', v_slot.status, 'platform', v_slot.platform, 'mode', v_slot.mode,
    'accountId', v_slot.account_id, 'zernioAccountId', v_account.zernio_account_id, 'accountStatus', v_account.status,
    'publishAt', to_jsonb(v_slot.publish_at), 'windowEndsAt', to_jsonb(v_slot.window_ends_at), 'options', v_slot.options,
    -- One key per attempt: a re-run inside an attempt repeats safely; a Retry is a new post, not Zernio's cached answer.
    'idempotencyKey', v_slot.idempotency_key || ':' || v_slot.attempts, 'approvalStatus', v_approval.status, 'snapshot', v_approval.snapshot,
    'current', v_current, 'export', v_export, 'media', v_media);
end;
$$;
revoke all on function public.publish_slot_read(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_slot_read(uuid, uuid, uuid) to service_role;

create or replace function public.publish_status(p_slot uuid, p_status text, p_external_id text default null,
  p_url text default null, p_error jsonb default null, p_zernio_account_id text default null)
returns public.schedule_slots language plpgsql volatile security definer set search_path = public
as $$
declare
  v_slot public.schedule_slots;
  v_d public.deliverables;
  v_url text := case when p_url ~ '^https://' and char_length(p_url) <= 500 then p_url end;
begin
  if char_length(p_external_id) > 200 then
    raise exception 'The post id is too long.' using errcode = '22023';
  end if;
  if p_slot is not null then
    select * into v_slot from public.schedule_slots where id = p_slot for update;
  elsif nullif(trim(coalesce(p_external_id, '')), '') is not null then
    select * into v_slot from public.schedule_slots where external_id = p_external_id order by updated_at desc limit 1 for update;
  end if;
  if v_slot.id is null then
    raise exception 'Slot not found.' using errcode = 'P0002';
  end if;
  if p_zernio_account_id is not null and not exists (select 1 from public.social_accounts
      where id = v_slot.account_id and zernio_account_id = p_zernio_account_id) then
    raise exception 'That post is not on this account.' using errcode = 'P0001';
  end if;
  if v_slot.status in ('published', 'cancelled') then
    return v_slot;
  end if;
  case p_status
    when 'publishing', 'accepted' then
      if v_slot.status in ('due', 'publishing') then
        update public.schedule_slots set status = 'publishing', external_id = coalesce(p_external_id, external_id),
          updated_at = now()
        where id = v_slot.id returning * into v_slot;
      end if;
    when 'published' then
      update public.schedule_slots
      set status = 'published', external_id = coalesce(p_external_id, external_id),
          external_url = coalesce(v_url, external_url), published_at = now(), lease_until = null, updated_at = now()
      where id = v_slot.id returning * into v_slot;
      -- Live: a Retry card left from an earlier failure is done with.
      perform public.approval_close('schedule_slot', v_slot.id, 'approved');
      select * into v_d from public.deliverables where id = v_slot.deliverable_id;
      if v_d.ref_kind = 'content_item' then
        update public.content_items set status = 'published', published_at = coalesce(published_at, now()),
          external_url = coalesce(v_url, external_url), updated_at = now()
        where id = v_d.ref_id and status <> 'published';
      end if;
    when 'failed' then
      if v_slot.status <> 'failed' then
        if p_error is null or jsonb_typeof(p_error) <> 'object' or jsonb_typeof(p_error->'message') <> 'string' then
          raise exception 'Say why it failed.' using errcode = '22023';
        end if;
        update public.schedule_slots
        set status = 'failed', lease_until = null, updated_at = now(),
            error = jsonb_build_object('code', left(coalesce(p_error->>'code', 'failed'), 40),
              'message', left(p_error->>'message', 500), 'retryable', coalesce(p_error->'retryable', 'true'::jsonb))
        where id = v_slot.id returning * into v_slot;
        perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
      end if;
    when 'intent' then
      if v_slot.status <> 'failed' then
        update public.schedule_slots
        set status = 'failed', mode = 'intent', account_id = null, lease_until = null, updated_at = now(),
            error = jsonb_build_object('code', 'no_account', 'retryable', true,
              'message', 'No connected ' || public.schedule_platform_label(v_slot.platform)
                || ' account: copy it and post it yourself, or connect the account and retry.')
        where id = v_slot.id returning * into v_slot;
        perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
      end if;
    else
      raise exception 'Unknown post status.' using errcode = '22023';
  end case;
  return v_slot;
end;
$$;
revoke all on function public.publish_status(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.publish_status(uuid, text, text, text, jsonb, text) to service_role;

create or replace function public.social_account_remove(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_slots uuid[];
  v_slot uuid;
begin
  if not exists (select 1 from public.social_accounts where id = p_id and user_id = v_user) then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
  -- Its slots not yet posting ask again without it: copy and open where the platform allows, else "connect it".
  with moved as (
    update public.schedule_slots
    set account_id = null, mode = 'intent', status = 'proposed', updated_at = now()
    where account_id = p_id and user_id = v_user and status in ('proposed', 'waiting')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_slots from moved;
  delete from public.social_accounts where id = p_id and user_id = v_user;
  foreach v_slot in array v_slots loop
    perform public.approval_raise(v_user, 'schedule_slot', v_slot);
  end loop;
end;
$$;
revoke all on function public.social_account_remove(uuid) from public, anon, authenticated;
grant execute on function public.social_account_remove(uuid) to authenticated, service_role;

create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_bucket text;
  v_plan text;
  v_quota record;
  v_expected int;
  v_window_start timestamptz;
  v_legacy_count int := 0;
  v_count int;
  v_allowed boolean := false;
begin
  v_bucket := case p_bucket
    when 'daily_preview' then 'preview'
    when 'daily_export' then 'export'
    else p_bucket
  end;

  if v_bucket in ('preview', 'export') then
    select coalesce(plan, 'free') into v_plan
    from public.profiles where id = v_user;
    select * into v_quota from public.plan_quota(v_plan);
    v_expected := case
      when v_bucket = 'preview' then v_quota.previews_per_day
      else v_quota.exports_per_day
    end;
    v_allowed := p_limit = v_expected and p_window_seconds = 86400;
    if p_bucket = 'preview' and p_limit = 2 and p_window_seconds = 60 then
      v_allowed := true;
    end if;
  else
    v_allowed := (p_bucket = 'presets' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'uploads' and p_limit = 30 and p_window_seconds = 3600)
      or (p_bucket = 'jobs' and p_limit = 10 and p_window_seconds = 3600)
      or (p_bucket = 'retry' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'draft' and p_limit = 120 and p_window_seconds = 60)
      or (p_bucket = 'project-write' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'mcp' and p_limit = 600 and p_window_seconds = 3600)
      -- P4: connecting and disconnecting social accounts (each call reaches Zernio).
      or (p_bucket = 'accounts' and p_limit = 30 and p_window_seconds = 3600)
      -- P4: moving a slot on the calendar and "I posted it" (`/api/v1/schedule/slots/[id]`).
      or (p_bucket = 'schedule' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'editor-write' and p_limit = 240 and p_window_seconds = 60)
      or (p_bucket = 'zip' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'media' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'scene_codes' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'feedback' and p_limit = 20 and p_window_seconds = 3600)
      -- 30 until motion quality A3 (PR #104) raised MCP previews to 60: both, so either PR can merge first.
      or (p_bucket = 'mcp_preview' and p_limit = 30 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_preview' and p_limit = 60 and p_window_seconds = 3600)
      -- POST /api/v1/generations: each request can run a paid moderation call.
      or (p_bucket = 'generations' and p_limit = 120 and p_window_seconds = 3600)
      -- `create_generation` itself: a direct PostgREST call skips the route's bucket.
      or (p_bucket = 'generation_create' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_look' and p_limit = 60 and p_window_seconds = 3600);
  end if;

  if not v_allowed then
    raise exception 'Invalid rate limit.' using errcode = '22023';
  end if;

  -- The short preview/export window counts in its own row: in the first minute after UTC
  -- midnight the 60-second and the daily window share a `window_start`, and used to add up
  -- into the daily quota (CI red at 00:00:24 UTC on 04/10).
  if v_bucket in ('preview', 'export') and p_window_seconds <> 86400 then
    v_bucket := v_bucket || ':' || p_window_seconds;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  if v_bucket in ('preview', 'export') and p_window_seconds = 86400 then
    select coalesce(max(count), 0) into v_legacy_count
    from public.rate_limits
      where user_id = v_user
      and bucket = 'daily_' || v_bucket
      and window_start = v_window_start;
  end if;

  insert into public.rate_limits(user_id, bucket, window_start, count)
  values(v_user, v_bucket, v_window_start, v_legacy_count + 1)
  on conflict (user_id, bucket, window_start)
  do update set count = greatest(public.rate_limits.count, v_legacy_count) + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

commit;
