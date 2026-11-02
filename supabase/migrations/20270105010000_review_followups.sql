-- 20270105010000: review follow-ups (docs/plans/cmo/2026-11-02-review-followups-plan.md). Each block names its item.

begin;

-- Q8: a domain with a path is a link, but not a code file name such as "Next.js/React" (the same rule as `hasLink`
-- in apps/web/lib/cmo/jobs/check-post.ts; the cases are packages/contracts/link-cases.json).
create or replace function public.caption_check(p_profile text, p_text text, p_title text) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
declare
  v_profile jsonb := public.platform_profile(p_profile);
  v_label text := v_profile->>'label';
  v_tags integer;
begin
  if v_profile is null or v_profile->>'kind' not in ('caption', 'youtube') then
    raise exception 'Captions are for Instagram, TikTok and YouTube.' using errcode = '22023';
  end if;
  if p_text is null or char_length(trim(p_text)) = 0 or char_length(p_text) > (v_profile->>'limit')::integer then
    raise exception 'A % is 1 to % characters.', v_label, to_char((v_profile->>'limit')::integer, 'FM999,999') using errcode = '22023';
  end if;
  if v_profile->>'kind' = 'youtube' then
    if p_title is null or char_length(trim(p_title)) = 0 or char_length(p_title) > (v_profile->>'title')::integer then
      raise exception 'A YouTube title is 1 to % characters.', v_profile->>'title' using errcode = '22023';
    end if;
  elsif p_title is not null then
    raise exception 'Only YouTube has a title.' using errcode = '22023';
  end if;
  if concat_ws(' ', p_title, p_text) ~* '(https?://|www\.|\m[a-z0-9][a-z0-9-]*\.(?!(jsx?|tsx?|mjs|py|rb|css|html?|md|json|ya?ml|txt|sql|vue|svelte)/)[a-z]{2,}/[^[:space:]])' then
    raise exception 'Captions carry no links.' using errcode = '22023';
  end if;
  -- `countHashtags` in lib/cmo/platforms.ts: `#word` with a letter in it, not `#1` or `a#b`.
  select count(*) into v_tags
  from regexp_matches(concat_ws(' ', p_title, p_text), '(^|[^[:alnum:]_&/])#[[:alnum:]_]*[[:alpha:]][[:alnum:]_]*', 'g');
  if v_tags > (v_profile->>'hashtags')::integer then
    raise exception 'A % carries at most % hashtags.', v_label, v_profile->>'hashtags' using errcode = '22023';
  end if;
end;
$$;

-- R2: allowlist entries nothing calls any more (the draft, mcp and zip buckets and the 30-an-hour MCP preview), and
-- consume_daily_task_quota, which nothing calls. The 2-a-minute preview stays for now: pgTAP 020 and 118 test the
-- short-window counting with it, and that code goes with it.
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
      or (p_bucket = 'project-write' and p_limit = 60 and p_window_seconds = 3600)
      -- P4: connecting and disconnecting social accounts (each call reaches Zernio).
      or (p_bucket = 'accounts' and p_limit = 30 and p_window_seconds = 3600)
      -- P4: moving a slot on the calendar and "I posted it" (`/api/v1/schedule/slots/[id]`).
      or (p_bucket = 'schedule' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'editor-write' and p_limit = 240 and p_window_seconds = 60)
      or (p_bucket = 'media' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'scene_codes' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'feedback' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_preview' and p_limit = 60 and p_window_seconds = 3600)
      -- POST /api/v1/generations: each request can run a paid moderation call.
      or (p_bucket = 'generations' and p_limit = 120 and p_window_seconds = 3600)
      -- `create_generation` itself: a direct PostgREST call skips the route's bucket.
      or (p_bucket = 'generation_create' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_look' and p_limit = 60 and p_window_seconds = 3600)
      -- Review R4 (20270102020000): routes that had no limit of their own.
      or (p_bucket = 'agent-turn' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'agent-continue' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'agent-session' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'captures' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'cmo-runs' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'onboarding' and p_limit = 20 and p_window_seconds = 3600)
      -- The CMO chat's thumbs (20270103010000).
      or (p_bucket = 'feedback-turn' and p_limit = 60 and p_window_seconds = 3600);
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

drop function if exists public.consume_daily_task_quota(text);

-- R3: 3D was removed on 2026-10-24; the limit is on explainer scenes (apps/web/lib/api/errors.ts maps it to 429).
create or replace function public.save_scene_code(p_code text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_hash text;
begin
  if p_code is null or btrim(p_code) = '' then
    raise exception 'Write the scene code first.' using errcode = '22023';
  end if;
  if char_length(p_code) > 32000 then
    raise exception 'The scene code is longer than 32000 characters.' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
  if not exists (select 1 from public.scene_codes where user_id = v_user and hash = v_hash) then
    if not public.rate_limit_hit('scene_codes', 300, 3600) then
      raise exception 'Too many explainer scenes in a short time. Try again later.' using errcode = 'P0001';
    end if;
    insert into public.scene_codes (user_id, hash, code) values (v_user, v_hash, p_code)
      on conflict do nothing;
  end if;
  return v_hash;
end;
$$;

-- C6: retry_job reads the balance the way every other charge does (profiles.credit_balance), not by summing the
-- whole ledger on each retry.
create or replace function public.retry_job(p_job_id uuid) RETURNS public.jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_hold int := public.job_hold_credits();
  v_spent int;
  v_balance int;
  v_status public.job_status;
  v_job public.jobs;
begin
  -- Khoá hồ sơ TRƯỚC khi đọc số dư, đúng thứ tự của `create_job`: hai tab bấm
  -- Retry cùng lúc không được tiêu quá số dư.
  perform 1 from public.profiles where id = v_user for update;

  -- Same caps as create_upload_edit: the route's limit alone is skipped by calling this RPC directly.
  if (select count(*) from public.jobs
      where user_id = v_user and status in ('queued', 'running') and purging_at is null) >= 3
  then
    raise exception 'You already have 3 projects in progress. Please wait for one to finish.'
      using errcode = 'P0001';
  end if;
  if not public.rate_limit_hit('retry', 20, 3600) then
    raise exception 'Too many retries. Please wait a while and try again.'
      using errcode = 'P0001';
  end if;

  select status into v_status
  from public.jobs
  where id = p_job_id and user_id = v_user and purging_at is null
  for update;

  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if v_status not in ('failed', 'cancelled') then
    raise exception 'Only a failed project can be run again.' using errcode = '22023';
  end if;

  -- Lần chạy trước có thể đã được hoàn credit (`finalize_job_failure`). Giữ lại
  -- đúng phần còn thiếu để một job không bao giờ bị tính tiền hai lần.
  v_spent := public.job_credits_spent(p_job_id);
  if v_spent < v_hold then
    v_balance := public.credit_balance(v_user);

    if v_balance < v_hold - v_spent then
      raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
        v_hold - v_spent, v_balance using errcode = 'P0001';
    end if;

    perform public.credit_hold(v_user, 'job', p_job_id, v_hold - v_spent, 'Hold for retry', p_job_id);
  end if;

  update public.jobs
  set status = 'queued',
      stage = 'queued',
      error = null,
      finished_at = null,
      -- attempt_id để null: worker của lần chạy cũ (nếu còn sống) ghi bằng
      -- attempt_id cũ sẽ bị mọi RPC có fence từ chối.
      attempt_id = null,
      lease_until = null,
      heartbeat_at = null,
      attempt_started_at = now(),
      call_id = null,
      attempt = 0
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- L6: aging in the task queue.
create or replace function public.claim_next_task(p_kinds text[], p_lease_seconds integer DEFAULT 120, p_max_running integer DEFAULT NULL::integer) RETURNS SETOF public.tasks
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.tasks
  set status = 'running',
      attempt = attempt + 1,
      attempt_id = gen_random_uuid(),
      lease_until = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      started_at = coalesce(started_at, now())
  where id = (
    select t.id from public.tasks t
    where t.status = 'queued' and t.kind = any(p_kinds)
      and (p_max_running is null
           or (select count(*) from public.tasks r where r.status = 'running' and r.kind = any(p_kinds)) < p_max_running)
    -- A task waiting over 10 minutes goes first, so a low-priority kind (publish_media, look_check) never starves
    -- behind requeued work. Then the user with the fewest running tasks, then kind order and age: fair across users,
    -- priority within one.
    order by (t.created_at < now() - interval '10 minutes') desc,
      (select count(*) from public.tasks r where r.status = 'running' and r.user_id = t.user_id),
      array_position(p_kinds, t.kind), t.created_at
    -- `skip locked`: parallel claims never take the same task.
    for update skip locked
    limit 1
  )
  returning *;
$$;

-- C3: the export count was released right before a `raise`, which rolls the release back with everything else: dead
-- code, removed. The day's export is given back where it can be: when the worker fails the export task.
create or replace function public.request_document_export(p_clip_id uuid, p_revision_id uuid, p_request_id uuid, p_resolution integer DEFAULT 1080) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_plan text;
  v_quota record;
  v_revision public.editor_revisions;
  v_manifest jsonb;
  v_job_id uuid;
  v_task public.tasks;
  v_task_id uuid := gen_random_uuid();
  v_object text;
begin
  if p_request_id is null then
    raise exception 'Missing request id.' using errcode = '22023';
  end if;
  if p_resolution is null or p_resolution not in (720, 1080) then
    raise exception 'Choose 720p or 1080p.' using errcode = '22023';
  end if;

  perform public.owned_clip(p_clip_id, v_user);
  select r.* into v_revision
  from public.editor_revisions r
  where r.id = p_revision_id and r.clip_id = p_clip_id;
  if not found then
    raise exception 'Save the project before exporting it.' using errcode = 'P0002';
  end if;
  select c.job_id into v_job_id from public.clips c where c.id = p_clip_id;
  select p.manifest into v_manifest from public.editor_projects p where p.clip_id = p_clip_id;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 1701));
  select * into v_task from public.tasks where request_id = p_request_id;
  if found then
    if v_task.user_id is distinct from v_user
       or v_task.kind <> 'render_document'
       or v_task.clip_id is distinct from p_clip_id
       or v_task.editor_revision_id is distinct from p_revision_id then
      raise exception 'This export request was already used for another clip or revision.'
        using errcode = '22023';
    end if;
    return v_task;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 1702));
  if (select count(*) from public.tasks
      where user_id = v_user
        and kind in ('preview', 'export', 'client_export', 'finalize', 'render_document', 'render_stills')
        and status in ('awaiting_upload', 'queued', 'running')) >= 20 then
    raise exception 'You already have 20 previews or exports in progress. Please wait for one to finish.'
      using errcode = 'P0001';
  end if;

  -- Renders OpenCMO orders itself (its Studio squads) do not spend the founder's daily exports; the cap above holds.
  if not public.studio_brain_call() then
    select coalesce(plan, 'free') into v_plan
    from public.profiles where id = v_user;
    select * into v_quota from public.plan_quota(v_plan);
    if not public.rate_limit_hit('export', v_quota.exports_per_day, 86400) then
      raise exception 'You have reached today''s limit for this plan.' using errcode = 'P0001';
    end if;
  end if;

  v_object := v_user::text || '/' || p_clip_id::text || '/' || v_task_id::text || '.mp4';
  insert into public.tasks(
    id, user_id, kind, clip_id, editor_revision_id, settings_hash, job_id,
    payload, status, request_id
  ) values (
    v_task_id, v_user, 'render_document', p_clip_id, p_revision_id,
    v_revision.source_hash, v_job_id,
    jsonb_build_object(
      'bucket', 'exports',
      'object', v_object,
      'editor_revision_id', p_revision_id,
      'source_hash', v_revision.source_hash,
      'resolution', p_resolution,
      'manifest', coalesce(v_manifest, '{"version":1,"folders":[],"assets":[]}'::jsonb)
    ),
    'queued', p_request_id
  )
  on conflict do nothing
  returning * into v_task;

  if not found then
    select * into v_task from public.tasks where request_id = p_request_id;
  end if;
  if not found then
    raise exception 'Could not start the export. Please try again.' using errcode = 'P0001';
  end if;
  if v_task.user_id is distinct from v_user
     or v_task.kind <> 'render_document'
     or v_task.clip_id is distinct from p_clip_id
     or v_task.editor_revision_id is distinct from p_revision_id then
    raise exception 'This request id was already used for something else.' using errcode = '22023';
  end if;
  return v_task;
end;
$$;

create or replace function public.request_stills_export(p_clip_id uuid, p_revision_id uuid, p_request_id uuid) RETURNS public.tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_plan text;
  v_quota record;
  v_revision public.editor_revisions;
  v_manifest jsonb;
  v_job_id uuid;
  v_task public.tasks;
  v_task_id uuid := gen_random_uuid();
  v_prefix text;
begin
  if p_request_id is null then
    raise exception 'Missing request id.' using errcode = '22023';
  end if;
  perform public.owned_clip(p_clip_id, v_user);
  select r.* into v_revision from public.editor_revisions r where r.id = p_revision_id and r.clip_id = p_clip_id;
  if not found then
    raise exception 'Save the project before exporting it.' using errcode = 'P0002';
  end if;
  select c.job_id into v_job_id from public.clips c where c.id = p_clip_id;
  select p.manifest into v_manifest from public.editor_projects p where p.clip_id = p_clip_id;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 1701));
  select * into v_task from public.tasks where request_id = p_request_id;
  if found then
    if v_task.user_id is distinct from v_user or v_task.kind <> 'render_stills'
       or v_task.clip_id is distinct from p_clip_id or v_task.editor_revision_id is distinct from p_revision_id then
      raise exception 'This export request was already used for another clip or revision.' using errcode = '22023';
    end if;
    return v_task;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 1702));
  if (select count(*) from public.tasks
      where user_id = v_user
        and kind in ('preview', 'export', 'client_export', 'finalize', 'render_document', 'render_stills')
        and status in ('awaiting_upload', 'queued', 'running')) >= 20 then
    raise exception 'You already have 20 previews or exports in progress. Please wait for one to finish.' using errcode = 'P0001';
  end if;
  if not public.studio_brain_call() then
    select coalesce(plan, 'free') into v_plan from public.profiles where id = v_user;
    select * into v_quota from public.plan_quota(v_plan);
    if not public.rate_limit_hit('export', v_quota.exports_per_day, 86400) then
      raise exception 'You have reached today''s limit for this plan.' using errcode = 'P0001';
    end if;
  end if;

  v_prefix := v_user::text || '/' || p_clip_id::text || '/' || v_task_id::text;
  insert into public.tasks (id, user_id, kind, clip_id, editor_revision_id, settings_hash, job_id, payload, status, request_id)
  values (v_task_id, v_user, 'render_stills', p_clip_id, p_revision_id, v_revision.source_hash, v_job_id,
    jsonb_build_object('bucket', 'exports', 'object', v_prefix || '.zip', 'still_prefix', v_prefix,
      'editor_revision_id', p_revision_id, 'source_hash', v_revision.source_hash,
      'manifest', coalesce(v_manifest, '{"version":1,"folders":[],"assets":[]}'::jsonb)),
    'queued', p_request_id)
  on conflict do nothing
  returning * into v_task;
  if not found then
    raise exception 'Could not start the export. Please try again.' using errcode = 'P0001';
  end if;
  return v_task;
end;
$$;

create or replace function public.fail_task(p_task_id uuid, p_attempt_id uuid, p_error text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_task public.tasks;
begin
  update public.tasks
  set status = 'failed',
      error = left(coalesce(p_error, 'Rendering failed. Please try again.'), 2000),
      finished_at = now(),
      lease_until = null
  where id = p_task_id and status = 'running'
    and attempt_id is not distinct from p_attempt_id
  returning * into v_task;

  if found then
    -- An export the worker could not finish gives the day's export back, counted on the day it was asked for.
    if v_task.kind in ('render_document', 'render_stills') then
      perform public.release_rate_limit_for(v_task.user_id, 'export', v_task.created_at);
    end if;
    return true;
  end if;

  return exists (
    select 1 from public.tasks
    where id = p_task_id and status = 'failed'
      and attempt_id is not distinct from p_attempt_id
  );
end;
$$;

-- C2: one lock order for finishing and cancelling a generation.
create or replace function public.complete_generation(p_task_id uuid, p_attempt_id uuid, p_object_name text, p_name text, p_duration numeric, p_width integer, p_height integer, p_credits integer, p_words jsonb DEFAULT NULL::jsonb, p_quality jsonb DEFAULT NULL::jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_task public.tasks;
  v_generation public.generations;
  v_asset public.media_assets;
  v_final int;
  v_words jsonb;
  v_quality jsonb;
  v_user uuid;
begin
  -- One lock order with cancel_generation and cancel_job: the founder's credits, then the generation, then the task
  -- (review follow-up C2). Task first here and generation first there could deadlock a cancel against a finish.
  select user_id into v_user from public.tasks where id = p_task_id;
  if not found then return false; end if;
  perform public.lock_credit_owner(v_user);
  select * into v_generation from public.generations where task_id = p_task_id for update;
  if not found then return false; end if;
  select * into v_task from public.tasks
  where id = p_task_id and kind = 'generate' and attempt_id is not distinct from p_attempt_id
  for update;
  if not found then return false; end if;
  if v_task.status = 'done' then
    return v_generation.status = 'done';
  end if;
  if v_task.status <> 'running' then return false; end if;
  -- The worker names the object itself; checked again so a worker bug cannot attach another
  -- project's file to this generation.
  if p_object_name is null
     or p_object_name !~ ('^' || v_task.user_id || '/' || v_task.job_id || '/gen-[0-9a-f-]{36}\.[a-z0-9]{2,5}$') then
    raise exception 'invalid generated object name';
  end if;

  -- Word timings matter for narrated media only: voiceovers and (v2) explainers, whose captions
  -- the editor builds from them. A bad shape is DROPPED, never failing a paid generation: the
  -- media still works, it just has no captions.
  if (v_generation.kind = 'voice'
      or exists (select 1 from public.ai_models m
                 where m.id = v_generation.model and m.provider = 'opencmo-motion'))
     and p_words is not null
     and jsonb_typeof(p_words) = 'array'
     and jsonb_array_length(p_words) <= 20000
     and octet_length(p_words::text) < 524288
     and not exists (
       select 1 from jsonb_array_elements(p_words) w
       where jsonb_typeof(w) <> 'object'
          or jsonb_typeof(w->'text') is distinct from 'string'
          or jsonb_typeof(w->'start') is distinct from 'number'
          or jsonb_typeof(w->'end') is distinct from 'number'
          or (w->>'start')::numeric < 0
          or (w->>'end')::numeric < (w->>'start')::numeric
     ) then
    v_words := p_words;
  end if;

  -- Long take F9: the garbled-text hint on a finished image. A hint, never a verdict: a bad shape is
  -- dropped and the generation still completes.
  if v_generation.kind = 'image' and public.generation_quality_ok(p_quality) then
    v_quality := p_quality;
  end if;

  insert into public.media_assets (user_id, job_id, storage_path, name, duration, width, height, status, words)
  values (v_task.user_id, v_task.job_id, 'media/' || p_object_name, left(coalesce(nullif(btrim(p_name), ''), 'Generated'), 200),
          p_duration, p_width, p_height, 'ready', v_words)
  returning * into v_asset;

  v_final := least(v_generation.credits_reserved, greatest(coalesce(p_credits, v_generation.credits_reserved), 0));
  update public.generations
  set status = 'done', credits_final = v_final, media_asset_id = v_asset.id, error = null, finished_at = now(),
      quality = v_quality
  where id = v_generation.id;
  if v_generation.credits_reserved - v_final > 0 then
    perform public.credit_settle(v_task.user_id, 'generation', v_generation.id, v_final, 'Generate refund', v_task.job_id);
  end if;
  update public.tasks
  set status = 'done', output = jsonb_build_object('media_asset_id', v_asset.id), error = null,
      finished_at = now(), lease_until = null
  where id = p_task_id;
  -- Shots that continue this one can start now; the worker's sweep claims them.
  update public.tasks set status = 'queued'
  where status = 'awaiting_input'
    and id in (select task_id from public.generations where after_id = v_generation.id);
  return true;
end;
$_$;

create or replace function public.cancel_generation(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_generation public.generations;
begin
  -- The same lock order as complete_generation: credits, generation, task (C2).
  perform public.lock_credit_owner(v_user);
  select * into v_generation from public.generations where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Generation not found.' using errcode = 'P0002';
  end if;
  if v_generation.status in ('queued', 'running') then
    update public.tasks
    set status = 'cancelled', error = 'Cancelled.', finished_at = now(), lease_until = null
    where id = v_generation.task_id and status in ('awaiting_input', 'queued', 'running');
  end if;
  select * into v_generation from public.generations where id = p_id;
  return to_jsonb(v_generation);
end;
$$;

commit;
