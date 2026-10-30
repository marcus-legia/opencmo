-- 20261230120000: P4 A2, firing (docs/plans/cmo/2026-10-28-p4-schedule-publish-plan.md F5, F7, F10;
-- schedule-publish.md §5, §8).
--
-- Modal's sweep calls schedule_claim_due() every minute. A slot past its window is missed and asks for a new time
-- (never late); a due slot whose approval still matches what goes out becomes one `publish_post` order and its CMO
-- run, leased until the window ends (never twice); an intent slot becomes a reminder. Nothing moves for a paused
-- founder. B's handler calls publish_slot_start right before posting (it checks everything again) and
-- publish_status after; the Zernio webhook calls publish_status too. A failure raises a card whose Retry posts
-- with the same idempotency key while the window lasts.
--
-- `publish_post` joins the CMO job kinds (free, 100 a day); the `accounts` rate-limit bucket serves B's connect
-- routes.

begin;

alter table public.cmo_runs drop constraint cmo_runs_kind_check;
alter table public.cmo_runs add constraint cmo_runs_kind_check check (kind in ('onboard', 'plan_week', 'post_draft', 'sales_scan',
  'competitor_research', 'pull_metrics', 'summarize_memory', 'review_week', 'write_caption', 'write_video_brief', 'write_slides',
  'publish_post'));

create or replace function public.cmo_job_price(p_kind text) returns integer
language sql immutable
as $$
  select case p_kind when 'plan_week' then 1 when 'post_draft' then 1 when 'sales_scan' then 5
    when 'competitor_research' then 2 when 'pull_metrics' then 0 when 'summarize_memory' then 0 when 'review_week' then 0
    when 'write_caption' then 1 when 'write_video_brief' then 1 when 'write_slides' then 1 when 'publish_post' then 0
    else 0 end
$$;

create or replace function public.cmo_job_daily_limit(p_kind text) returns integer
language sql immutable
as $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'write_video_brief' then 5 when 'write_slides' then 10 when 'publish_post' then 100
    else 0 end
$$;

create or replace function public.work_order_department(p_kind text) returns text
language sql immutable set search_path = public
as $$
  select case p_kind
    when 'post_draft' then 'writer' when 'sales_scan' then 'sales'
    when 'competitor_research' then 'research' when 'pull_metrics' then 'research' when 'review_week' then 'research'
    when 'build_video' then 'studio' when 'cut_shorts' then 'studio'
    when 'publish_post' then 'publish' when 'write_caption' then 'writer' when 'write_video_brief' then 'writer' when 'write_slides' then 'writer'
    else 'brain' end
$$;
revoke all on function public.work_order_department(text) from public, anon, authenticated;

create or replace function public.cmo_enqueue(p_user uuid, p_kind text, p_input jsonb) returns public.cmo_runs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.cmo_runs;
  v_price integer := case
    when p_input->>'brain' = 'claude' and public.is_paid(p_user) then 0
    else public.cmo_job_price(p_kind)
  end;
  v_key text := case when p_kind in ('post_draft', 'write_caption', 'write_video_brief', 'write_slides', 'publish_post')
    then coalesce(p_input->>'item_id', p_input->>'order_id') end;
begin
  if p_kind is null or p_kind = 'onboard' or public.cmo_job_daily_limit(p_kind) <= 0 then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 4096 then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  -- Replays are started by inbox_submit only, for an item the founder owns.
  if p_input ? 'inbox' then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  if public.cmo_paused(p_user) then
    raise exception 'Your CMO is paused. Resume it to start new work.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':cmo_run', 1713));

  select * into v_row from public.cmo_runs
  where user_id = p_user and kind = p_kind and status in ('queued', 'running')
    and (status = 'queued' or lease_until is null or lease_until > now())
    and (v_key is null or coalesce(input->>'item_id', input->>'order_id') = v_key)
  order by created_at desc limit 1;
  if found then
    return v_row;
  end if;

  if (select count(*) from public.cmo_runs
      where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day'
        and not (input ? 'inbox')) >= public.cmo_job_daily_limit(p_kind) then
    raise exception 'You have reached today''s limit for this task. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if v_price > 0 and public.credit_balance(p_user) < v_price then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_price, public.credit_balance(p_user) using errcode = 'P0001';
  end if;

  insert into public.cmo_runs (user_id, kind, status, input, credits)
  values (p_user, p_kind, 'queued', p_input, v_price) returning * into v_row;
  if v_price > 0 then
    perform public.credit_hold(p_user, 'cmo_run', v_row.id, v_price, 'CMO hold');
  end if;
  return v_row;
end;
$$;

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

create index schedule_slots_external_idx on public.schedule_slots (external_id) where external_id is not null;

-- The approval a slot fires on is approved and covers exactly what goes out now.
create or replace function public.schedule_approval_holds(p_slot public.schedule_slots)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.approvals a
    where a.id = p_slot.approval_id and a.ref_kind = 'schedule_slot' and a.ref_id = p_slot.id
      and a.status in ('approved', 'edited')
      and a.content_hash = public.approval_hash(public.approval_snapshot('schedule_slot', p_slot.id)))
$$;
revoke all on function public.schedule_approval_holds(public.schedule_slots) from public, anon, authenticated;

-- A slot that cannot go out at its time asks for a new one: its card (if still waiting) expires and Schedule
-- proposes again, within maxProposals.
create or replace function public.schedule_miss(p_slot public.schedule_slots, p_reason text)
returns void language plpgsql volatile security definer set search_path = public
as $$
begin
  update public.schedule_slots
  set status = 'missed', lease_until = null, updated_at = now(),
      error = case when p_reason is null then error else jsonb_build_object('code', 'missed', 'message', p_reason) end
  where id = p_slot.id;
  update public.approvals set status = 'expired', decided_at = now()
  where ref_kind = 'schedule_slot' and ref_id = p_slot.id and status = 'waiting';
  begin
    perform public.schedule_propose(p_slot.deliverable_id);
  exception when others then
    raise warning 'schedule: could not propose again for slot %: %', p_slot.id, sqlerrm;
  end;
end;
$$;
revoke all on function public.schedule_miss(public.schedule_slots, text) from public, anon, authenticated;

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
    if v_slot.mode = 'intent' then
      update public.schedule_slots set status = 'reminded', updated_at = now() where id = v_slot.id;
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

-- B's publish_post handler, right before posting: the slot is still due and inside its window, its approval still
-- covers what goes out, the account is connected. Marks it publishing and returns what to post, with the platform
-- fields under the adapter's names (lib/departments/publish/types.ts PlatformFields).
create or replace function public.publish_slot_start(p_slot uuid)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  v_slot public.schedule_slots;
  v_snapshot jsonb;
  v_zernio text;
  v_render text;
  v_fields jsonb;
begin
  select * into v_slot from public.schedule_slots where id = p_slot for update;
  if not found then
    raise exception 'Slot not found.' using errcode = 'P0002';
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
  select zernio_account_id into v_zernio from public.social_accounts where id = v_slot.account_id and status = 'connected';
  if v_zernio is null then
    raise exception 'Reconnect your % account first.', public.schedule_platform_label(v_slot.platform) using errcode = 'P0001';
  end if;
  v_snapshot := public.approval_snapshot('schedule_slot', v_slot.id);
  if v_snapshot->>'clip_id' is not null then
    -- The render of exactly the approved edit.
    select t.output_path into v_render from public.tasks t join public.editor_projects p on p.clip_id = t.clip_id
    where t.clip_id = (v_snapshot->>'clip_id')::uuid and t.kind = 'render_document' and t.status = 'done'
      and t.settings_hash = public.editor_document_hash(p.document) and t.output_path is not null
    order by t.finished_at desc nulls last limit 1;
    if v_render is null then
      raise exception 'The video is not rendered yet.' using errcode = 'P0001';
    end if;
  end if;
  v_fields := case when v_slot.platform = 'tiktok' then jsonb_build_object('platform', 'tiktok',
      'privacy', v_slot.options->'privacy', 'allowComment', v_slot.options->'allow_comment',
      'allowDuet', coalesce(v_slot.options->'allow_duet', 'null'::jsonb),
      'allowStitch', coalesce(v_slot.options->'allow_stitch', 'null'::jsonb),
      'aiGenerated', coalesce(v_slot.options->'ai_label', 'false'::jsonb))
    else jsonb_build_object('platform', v_slot.platform, 'aiGenerated', coalesce(v_slot.options->'ai_label', 'false'::jsonb)) end;
  update public.schedule_slots set status = 'publishing', attempts = attempts + 1, updated_at = now() where id = v_slot.id;
  return jsonb_build_object('slot_id', v_slot.id, 'user_id', v_slot.user_id, 'deliverable_id', v_slot.deliverable_id,
    'deliverable_kind', v_snapshot->>'deliverable_kind', 'platform', v_slot.platform, 'zernio_account_id', v_zernio,
    'idempotency_key', v_slot.idempotency_key, 'publish_at', v_snapshot->>'publish_at',
    'text', v_snapshot->'text', 'title', v_snapshot->'title', 'clip_id', v_snapshot->'clip_id',
    'render_path', to_jsonb(v_render), 'fields', v_fields, 'attempt', v_slot.attempts + 1);
end;
$$;
revoke all on function public.publish_slot_start(uuid) from public, anon, authenticated;
grant execute on function public.publish_slot_start(uuid) to service_role;

-- What happened, from B's handler or the Zernio webhook (slot by id, or by Zernio's post id). Repeats are no-ops.
-- `accepted`: Zernio took it, the webhook confirms later. `published`: live; a post's row is published with its
-- link. `failed`: a card says why and its Retry posts again with the same idempotency key while the window lasts.
create or replace function public.publish_status(p_slot uuid, p_external_id text, p_status text, p_url text default null,
  p_error jsonb default null)
returns public.schedule_slots language plpgsql volatile security definer set search_path = public
as $$
declare
  v_slot public.schedule_slots;
  v_d public.deliverables;
  v_url text := case when p_url ~ '^https://' and char_length(p_url) <= 500 then p_url end;
  v_message text;
begin
  if p_slot is not null then
    select * into v_slot from public.schedule_slots where id = p_slot for update;
  elsif nullif(trim(coalesce(p_external_id, '')), '') is not null then
    select * into v_slot from public.schedule_slots where external_id = p_external_id order by updated_at desc limit 1 for update;
  end if;
  if v_slot.id is null then
    raise exception 'Slot not found.' using errcode = 'P0002';
  end if;
  if char_length(p_external_id) > 200 then
    raise exception 'The post id is too long.' using errcode = '22023';
  end if;
  case p_status
    when 'accepted' then
      if v_slot.status in ('due', 'publishing') then
        update public.schedule_slots set status = 'publishing', external_id = coalesce(p_external_id, external_id),
          updated_at = now()
        where id = v_slot.id returning * into v_slot;
      end if;
    when 'published' then
      if v_slot.status <> 'published' then
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
      end if;
    when 'failed' then
      if v_slot.status not in ('published', 'failed', 'cancelled') then
        if p_error is null or jsonb_typeof(p_error) <> 'object' or jsonb_typeof(p_error->'message') <> 'string' then
          raise exception 'Say why it failed.' using errcode = '22023';
        end if;
        v_message := left(p_error->>'message', 500);
        update public.schedule_slots
        set status = 'failed', lease_until = null, updated_at = now(),
            error = jsonb_build_object('code', left(coalesce(p_error->>'code', 'failed'), 40), 'message', v_message,
              'retryable', coalesce(p_error->'retryable', 'true'::jsonb))
        where id = v_slot.id returning * into v_slot;
        perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
      end if;
    else
      raise exception 'Unknown post status.' using errcode = '22023';
  end case;
  return v_slot;
end;
$$;
revoke all on function public.publish_status(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_status(uuid, text, text, text, jsonb) to service_role;

commit;
