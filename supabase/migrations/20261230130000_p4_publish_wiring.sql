-- 20261230130000: P4 A2, wiring the publish_post handler (B3), the webhook (B5) and the upload (B4), and the
-- requests B and C sent while A1–A2 were built (docs/plans/cmo/2026-10-28-p4-sessions/A.md, Requests).
--
-- - Only Schedule orders `publish_post`: a founder (or any caller of enqueue_cmo_run[_for]) could otherwise queue
--   one naming another founder's slot. The runner's reads and writes also name the run's user and order, and the
--   order must be the one the claim made for that slot.
-- - publish_slot_read gives the handler the slot, its account, its approval and what would go out now;
--   publish_slot_start takes the order too; publish_media_queue starts B4's upload of the approved export.
-- - publish_status takes B's shape (status before ids, `publishing` and `intent`, the webhook's account check) and
--   never moves a published slot back.
-- - zernio_receipt_claim records a webhook event once; social_account_mark follows Zernio's account events.
-- - TikTok's posting guidelines: toggles start off, privacy is the founder's pick, commercial content disclosure
--   (brand_organic, brand_content) is one more pair of toggles.
-- - A slot missed for a reason carries it onto the new card.

begin;

-- `publish_media` (B4): the kind list, task-kinds.json and the handler land together.
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in (
  'probe_media', 'generate', 'render_document', 'transcribe_media', 'transcribe_asset', 'capture_page', 'publish_media'
));

alter table public.schedule_slots add column media_task_id uuid references public.tasks(id) on delete set null;

create or replace function public.enqueue_cmo_run(p_kind text, p_input jsonb default '{}'::jsonb)
returns public.cmo_runs language plpgsql security definer set search_path = public
as $$
begin
  -- Posting is ordered only by Schedule, for a slot whose card the founder approved.
  if p_kind = 'publish_post' then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  return public.cmo_enqueue(public.require_user(), p_kind, p_input);
end;
$$;

create or replace function public.enqueue_cmo_run_for(p_user uuid, p_kind text, p_input jsonb default '{}'::jsonb)
returns public.cmo_runs language plpgsql security definer set search_path = public
as $$
begin
  if p_kind = 'publish_post' then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  return public.cmo_enqueue(p_user, p_kind, p_input);
end;
$$;

-- The run is the one Schedule made for this slot: its user, its order, the order's slot.
create or replace function public.publish_slot_guard(p_slot uuid, p_user uuid, p_order uuid)
returns public.schedule_slots language plpgsql volatile security definer set search_path = public
as $$
declare
  v_slot public.schedule_slots;
begin
  select * into v_slot from public.schedule_slots where id = p_slot and user_id = p_user for update;
  if not found or not exists (select 1 from public.work_orders
      where id = p_order and user_id = p_user and kind = 'publish_post' and brief->>'slot_id' = p_slot::text) then
    raise exception 'Slot not found.' using errcode = 'P0002';
  end if;
  return v_slot;
end;
$$;
revoke all on function public.publish_slot_guard(uuid, uuid, uuid) from public, anon, authenticated;

-- What the handler reads each time it runs (B3 FiredSlot): the slot, its account, the card it fires on, what would
-- go out this second, the export of the approved edit, and the upload's state.
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
    'idempotencyKey', v_slot.idempotency_key, 'approvalStatus', v_approval.status, 'snapshot', v_approval.snapshot,
    'current', v_current, 'export', v_export, 'media', v_media);
end;
$$;
revoke all on function public.publish_slot_read(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_slot_read(uuid, uuid, uuid) to service_role;

drop function public.publish_slot_start(uuid);
-- Due → publishing, right before the handler's first step: inside the window, not paused, still approved as it is.
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
  update public.schedule_slots set status = 'publishing', attempts = attempts + 1, updated_at = now()
  where id = v_slot.id returning * into v_slot;
  return v_slot;
end;
$$;
revoke all on function public.publish_slot_start(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_slot_start(uuid, uuid, uuid) to service_role;

-- B4's upload of the approved export to Zernio's presigned URL. The export must be the founder's own (its path
-- starts with their id) and the URL https; the worker checks both again.
create or replace function public.publish_media_queue(p_slot uuid, p_user uuid, p_order uuid, p_object text,
  p_upload_url text, p_public_url text)
returns uuid language plpgsql volatile security definer set search_path = public
as $$
declare
  v_slot public.schedule_slots := public.publish_slot_guard(p_slot, p_user, p_order);
  v_task uuid;
begin
  if v_slot.status <> 'publishing' then
    raise exception 'This post is not being published.' using errcode = 'P0001';
  end if;
  if p_object is null or p_object !~ ('^' || p_user::text || '/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$') then
    raise exception 'That export is not this founder''s.' using errcode = '22023';
  end if;
  if p_upload_url !~ '^https://' or char_length(p_upload_url) > 2048
     or p_public_url !~ '^https://' or char_length(p_public_url) > 2048 then
    raise exception 'The upload address is not valid.' using errcode = '22023';
  end if;
  insert into public.tasks (user_id, kind, clip_id, payload, request_id, status)
  values (p_user, 'publish_media', (public.approval_snapshot('schedule_slot', p_slot)->>'clip_id')::uuid,
    jsonb_build_object('bucket', 'exports', 'object', p_object, 'upload_url', p_upload_url, 'public_url', p_public_url,
      'content_type', 'video/mp4', 'slot_id', p_slot),
    gen_random_uuid(), 'queued')
  returning id into v_task;
  update public.schedule_slots set media_task_id = v_task, updated_at = now() where id = p_slot;
  return v_task;
end;
$$;
revoke all on function public.publish_media_queue(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.publish_media_queue(uuid, uuid, uuid, text, text, text) to service_role;

drop function public.publish_status(uuid, text, text, text, jsonb);
-- What happened, from B's handler or the Zernio webhook (slot by id, or by Zernio's post id). Monotonic: a published
-- slot never moves back (Zernio retries webhooks and events arrive out of order); a repeat is a no-op. The webhook
-- names the account it saw; a slot on another account is refused.
--   published   live; a post's row is published with its link
--   publishing  Zernio took it; the webhook confirms later (`accepted` is the same)
--   failed      a card says why; its Retry posts with the same idempotency key while the window lasts
--   intent      no connected account: the card offers copy and open instead
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

-- A webhook event, once: true the first time its signed body id is seen.
create or replace function public.zernio_receipt_claim(p_event_id text)
returns boolean language plpgsql volatile security definer set search_path = public
as $$
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 200 then
    raise exception 'The event id is not valid.' using errcode = '22023';
  end if;
  insert into public.zernio_receipts (event_id) values (p_event_id) on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.zernio_receipt_claim(text) from public, anon, authenticated;
grant execute on function public.zernio_receipt_claim(text) to service_role;

-- Zernio says an account was disconnected or refuses posts: its slots still waiting ask the founder again (their
-- card cannot be approved until the account is back).
create or replace function public.social_account_mark(p_zernio_account_id text, p_status text)
returns integer language plpgsql volatile security definer set search_path = public
as $$
declare
  v_account public.social_accounts;
  v_slot public.schedule_slots;
  v_n integer := 0;
begin
  if p_status not in ('connected', 'disconnected', 'error') then
    raise exception 'Unknown account status.' using errcode = '22023';
  end if;
  update public.social_accounts set status = p_status, updated_at = now()
  where zernio_account_id = p_zernio_account_id returning * into v_account;
  if v_account.id is null or p_status = 'connected' then
    return 0;
  end if;
  for v_slot in select * from public.schedule_slots where account_id = v_account.id and status = 'waiting' for update loop
    update public.schedule_slots set status = 'proposed', updated_at = now() where id = v_slot.id;
    perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.social_account_mark(text, text) from public, anon, authenticated;
grant execute on function public.social_account_mark(text, text) to service_role;

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
    select array_agg(platform) into v_platforms from public.content_items
    where id = v_d.ref_id and status = 'approved' and platform in ('x', 'threads', 'linkedin');
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

create or replace function public.schedule_options_merge(p_platform text, p_current jsonb, p_new jsonb)
returns jsonb language plpgsql immutable set search_path = public
as $$
declare
  v_key text;
  v_value jsonb;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'object' then
    raise exception 'The platform settings are malformed.' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_new) loop
    if v_key not in ('privacy', 'allow_comment', 'allow_duet', 'allow_stitch', 'brand_organic', 'brand_content', 'ai_label') then
      raise exception 'Unknown platform setting "%".', left(v_key, 40) using errcode = '22023';
    end if;
    if v_key <> 'ai_label' and p_platform <> 'tiktok' then
      raise exception 'That setting is only for TikTok.' using errcode = '22023';
    end if;
    if v_key = 'privacy' then
      if jsonb_typeof(v_value) <> 'string' or v_value #>> '{}' not in
         ('PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY') then
        raise exception 'Choose who can see it from TikTok''s list.' using errcode = '22023';
      end if;
    elsif jsonb_typeof(v_value) <> 'boolean' then
      raise exception 'A platform toggle is on or off.' using errcode = '22023';
    end if;
  end loop;
  return coalesce(p_current, '{}'::jsonb) || p_new;
end;
$$;
revoke all on function public.schedule_options_merge(text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.schedule_ready_check(p_slot public.schedule_slots)
returns void language plpgsql stable security definer set search_path = public
as $$
begin
  if p_slot.mode = 'intent' then
    if p_slot.platform in ('tiktok', 'instagram', 'youtube') then
      raise exception 'Connect your % account to post this.', public.schedule_platform_label(p_slot.platform)
        using errcode = 'P0001';
    end if;
    return;
  end if;
  if not exists (select 1 from public.social_accounts where id = p_slot.account_id and status = 'connected') then
    raise exception 'Reconnect your % account first.', public.schedule_platform_label(p_slot.platform) using errcode = 'P0001';
  end if;
  if p_slot.platform = 'tiktok' and jsonb_typeof(p_slot.options->'privacy') is distinct from 'string' then
    raise exception 'Choose who can see it on TikTok.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.schedule_ready_check(public.schedule_slots) from public, anon, authenticated;

create or replace function public.schedule_miss(p_slot public.schedule_slots, p_reason text)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_new public.schedule_slots;
begin
  update public.schedule_slots
  set status = 'missed', lease_until = null, updated_at = now(),
      error = case when p_reason is null then error else jsonb_build_object('code', 'missed', 'message', p_reason) end
  where id = p_slot.id;
  update public.approvals set status = 'expired', decided_at = now()
  where ref_kind = 'schedule_slot' and ref_id = p_slot.id and status = 'waiting';
  begin
    perform public.schedule_propose(p_slot.deliverable_id);
    -- The new card says why it asks again (the slot keeps it in `last_error`).
    if p_reason is not null then
      for v_new in select * from public.schedule_slots
        where deliverable_id = p_slot.deliverable_id and platform = p_slot.platform and status = 'proposed' and id <> p_slot.id
      loop
        update public.schedule_slots set error = jsonb_build_object('code', 'missed', 'message', p_reason) where id = v_new.id;
        perform public.approval_raise(v_new.user_id, 'schedule_slot', v_new.id);
      end loop;
    end if;
  exception when others then
    raise warning 'schedule: could not propose again for slot %: %', p_slot.id, sqlerrm;
  end;
end;
$$;
revoke all on function public.schedule_miss(public.schedule_slots, text) from public, anon, authenticated;

commit;
