-- Own-video editing, Track A (docs/own-video-editing-build.md): a transcript belongs to the
-- stored FILE, not to a clip. Every video or sound uploaded into a project library gets one
-- automatically and for free after its probe (within a daily cap), and every clip that plays the
-- file reuses it: `use_media_transcript` slices it to the element's window into the clip's
-- `editor_transcripts`, and the paid `request_media_captions` returns it without charging.
--
-- Automatic runs move no credits, so they never touch credit_hold / credit_settle /
-- credit_refund. The paid path is unchanged apart from the reuse.

begin;

alter table public.tasks drop constraint tasks_kind_check;
alter table public.tasks
  add constraint tasks_kind_check
  check (kind in ('probe_media', 'zip', 'generate', 'render_document', 'prepare_full',
                  'transcribe_media', 'transcribe_asset'));

alter table public.media_assets
  add column has_audio boolean,
  add column transcript_status text not null default 'none'
    constraint media_assets_transcript_status_check
    check (transcript_status in ('none', 'queued', 'running', 'ready', 'failed', 'skipped'));

-- One transcript per stored file, in FILE seconds, same JSON shape as `check_transcript_body`.
create table public.media_transcripts (
  asset_id uuid primary key references public.media_assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  body text not null check (octet_length(body) < 524288),
  seconds numeric not null check (seconds > 0),
  source text not null check (source in ('scribe', 'fake', 'import')),
  created_at timestamptz not null default now()
);

alter table public.media_transcripts enable row level security;
create policy "read own media transcripts" on public.media_transcripts
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.media_transcripts to authenticated;
grant all on public.media_transcripts to service_role;

/** Free automatic transcription per user per UTC day, in seconds of audio (owner decision, 180 min). */
create or replace function public.auto_transcript_daily_seconds()
returns numeric language sql immutable as $$ select 10800::numeric $$;

-- Queue the free transcription of one file, or say why not. Callers hold the asset row lock.
-- Returns the new transcript_status. Internal: no grant to clients.
create or replace function public.queue_asset_transcript(p_asset_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.media_assets;
  v_used numeric;
  v_status text;
begin
  select * into v_asset from public.media_assets where id = p_asset_id for update;
  if not found then return null; end if;
  if v_asset.transcript_status in ('queued', 'running', 'ready') then
    return v_asset.transcript_status;
  end if;
  if v_asset.status <> 'ready' or v_asset.storage_path not like 'media/%' then
    return v_asset.transcript_status;
  end if;
  if v_asset.has_audio is distinct from true or v_asset.duration is null or v_asset.duration < 0.5 then
    v_status := 'none';
  elsif v_asset.duration > public.captions_max_seconds() then
    v_status := 'skipped';
  else
    -- Lock per user so two uploads finishing together cannot both slip under the cap.
    perform public.lock_credit_owner(v_asset.user_id);
    select coalesce(sum(a.duration), 0) into v_used
    from public.tasks t join public.media_assets a on a.id = t.asset_id
    where t.user_id = v_asset.user_id and t.kind = 'transcribe_asset'
      and t.status in ('queued', 'running', 'done')
      and t.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    if v_used + v_asset.duration > public.auto_transcript_daily_seconds() then
      v_status := 'skipped';
    else
      insert into public.tasks (user_id, kind, job_id, asset_id, payload, status, request_id)
      values (v_asset.user_id, 'transcribe_asset', v_asset.job_id, v_asset.id,
              jsonb_build_object('scope', 'file', 'auto', true, 'credits', 0), 'queued', gen_random_uuid());
      v_status := 'queued';
    end if;
  end if;
  update public.media_assets set transcript_status = v_status where id = v_asset.id;
  return v_status;
end;
$$;

revoke all on function public.queue_asset_transcript(uuid) from public, anon, authenticated;
grant execute on function public.queue_asset_transcript(uuid) to service_role;

-- The probe now also reports whether the file has an audio stream; a ready file with audio
-- is queued for its free transcript in the same transaction.
drop function public.complete_media_probe(uuid, uuid, numeric, integer, integer, boolean, text);
create function public.complete_media_probe(
  p_asset_id uuid, p_attempt_id uuid, p_duration numeric, p_width integer, p_height integer,
  p_ok boolean, p_error text default null, p_has_audio boolean default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_error text := case when p_ok then null
    else left(coalesce(p_error, 'We could not read this media file.'), 2000) end;
begin
  if p_attempt_id is null or p_ok is null then return false; end if;
  select * into v_task from public.tasks
  where kind = 'probe_media' and asset_id = p_asset_id and attempt_id = p_attempt_id
  for update;
  if not found then return false; end if;
  if v_task.status in ('done', 'failed') then
    return v_task.status = case when p_ok then 'done' else 'failed' end
      and v_task.duration is not distinct from p_duration
      and v_task.width is not distinct from p_width
      and v_task.height is not distinct from p_height
      and v_task.error is not distinct from v_error;
  end if;
  if v_task.status <> 'running' then return false; end if;
  update public.tasks set status = case when p_ok then 'done' else 'failed' end,
    duration = p_duration, width = p_width, height = p_height, error = v_error,
    finished_at = now(), lease_until = null where id = v_task.id;
  update public.media_assets set status = case when p_ok then 'ready' else 'rejected' end,
    duration = p_duration, width = p_width, height = p_height, error = left(v_error, 500),
    has_audio = case when p_ok then p_has_audio end
  where id = p_asset_id;
  if p_ok then
    perform public.queue_asset_transcript(p_asset_id);
  end if;
  return true;
end;
$$;

revoke all on function public.complete_media_probe(uuid, uuid, numeric, integer, integer, boolean, text, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_media_probe(uuid, uuid, numeric, integer, integer, boolean, text, boolean)
  to service_role;

-- Worker: store the file transcript and finish the task in one transaction; returns the hash.
-- A repeated call for the same attempt returns the stored hash (idempotent like captions).
create or replace function public.complete_media_transcript(p_task_id uuid, p_attempt_id uuid, p_body text, p_source text default 'scribe')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_asset public.media_assets;
  v_hash text;
begin
  select * into v_task from public.tasks
  where id = p_task_id and kind = 'transcribe_asset' and status = 'running'
    and attempt_id is not distinct from p_attempt_id
  for update;
  if not found then
    select output ->> 'hash' into v_hash from public.tasks
    where id = p_task_id and kind = 'transcribe_asset' and status = 'done'
      and attempt_id is not distinct from p_attempt_id;
    return v_hash;
  end if;
  perform public.check_transcript_body(p_body);
  select * into v_asset from public.media_assets where id = v_task.asset_id and user_id = v_task.user_id;
  if not found then
    raise exception 'This file is no longer stored with this project.' using errcode = 'P0002';
  end if;
  v_hash := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');
  insert into public.media_transcripts (asset_id, user_id, hash, body, seconds, source)
  values (v_asset.id, v_asset.user_id, v_hash, p_body, greatest(v_asset.duration, 0.001), p_source)
  on conflict (asset_id) do update
    set hash = excluded.hash, body = excluded.body, seconds = excluded.seconds,
        source = excluded.source, created_at = now();
  update public.tasks
  set status = 'done', error = null, finished_at = now(), lease_until = null,
      output = jsonb_build_object('hash', v_hash)
  where id = p_task_id;
  return v_hash;
end;
$$;

revoke all on function public.complete_media_transcript(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_media_transcript(uuid, uuid, text, text) to service_role;

-- transcript_status follows its task, whichever path ends it (worker, fail_task, lease reaper).
create or replace function public.sync_asset_transcript_from_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'transcribe_asset' or new.asset_id is null or new.status is not distinct from old.status then
    return new;
  end if;
  update public.media_assets
  set transcript_status = case new.status
    when 'running' then 'running'
    when 'queued' then 'queued'
    when 'done' then 'ready'
    else 'failed' end
  where id = new.asset_id and transcript_status <> 'ready';
  return new;
end;
$$;

revoke all on function public.sync_asset_transcript_from_task() from public, anon, authenticated;
create trigger tasks_sync_asset_transcript after update of status on public.tasks
  for each row execute function public.sync_asset_transcript_from_task();

-- The words of a file transcript whose start is inside [p_in, p_out), in FILE seconds (the
-- convention of library captions). A segment cut by the window keeps only its words.
create or replace function public.slice_transcript(p_body jsonb, p_in numeric, p_out numeric)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(segment order by ord), '[]'::jsonb)
  from (
    select s.ord,
      case when kept.total = kept.n then s.seg
           else jsonb_build_object('text', kept.text, 'words', kept.words) end as segment
    from jsonb_array_elements(p_body) with ordinality as s(seg, ord)
    cross join lateral (
      select count(*) filter (where (w ->> 'start')::numeric >= p_in and (w ->> 'start')::numeric < p_out) as n,
             count(*) as total,
             coalesce(jsonb_agg(w order by wi) filter (where (w ->> 'start')::numeric >= p_in and (w ->> 'start')::numeric < p_out), '[]'::jsonb) as words,
             string_agg(w ->> 'text', ' ' order by wi) filter (where (w ->> 'start')::numeric >= p_in and (w ->> 'start')::numeric < p_out) as text
      from jsonb_array_elements(s.seg -> 'words') with ordinality as x(w, wi)
    ) kept
    where kept.n > 0
  ) parts;
$$;

-- Store the slice for a clip (content-addressed, like every editor transcript); returns its hash.
create or replace function public.store_transcript_slice(p_clip_id uuid, p_body jsonb, p_in numeric, p_out numeric)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := public.slice_transcript(p_body, p_in, p_out)::text;
  v_hash text;
begin
  perform public.check_transcript_body(v_body);
  v_hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  insert into public.editor_transcripts (clip_id, hash, body)
  values (p_clip_id, v_hash, v_body)
  on conflict (clip_id, hash) do nothing;
  return v_hash;
end;
$$;

revoke all on function public.store_transcript_slice(uuid, jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.slice_transcript(jsonb, numeric, numeric) from public, anon;
grant execute on function public.slice_transcript(jsonb, numeric, numeric) to authenticated, service_role;

-- The file's transcript for an element of a clip the caller owns, sliced to the element's window.
--   {"status":"ready","src":"assets/transcripts/<hash>.json","hash":…}
--   {"status":"pending"}   queued or running
--   {"status":"none"}      no audio, skipped or failed: the caller may offer the paid path
create or replace function public.use_media_transcript(
  p_clip_id uuid, p_media_id uuid, p_source_in numeric default 0, p_source_out numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_clip public.clips;
  v_asset public.media_assets;
  v_body text;
  v_in numeric;
  v_out numeric;
  v_hash text;
begin
  v_clip := public.owned_clip(p_clip_id, v_user);
  select * into v_asset from public.media_assets
  where id = p_media_id and user_id = v_user and job_id = v_clip.job_id
    and status <> 'rejected' and storage_path like 'media/%';
  if not found then
    raise exception 'This file is not stored with this project. Wait for it to finish uploading.' using errcode = 'P0002';
  end if;
  select body into v_body from public.media_transcripts where asset_id = v_asset.id;
  if v_body is null then
    return jsonb_build_object('status', case when v_asset.transcript_status in ('queued', 'running') then 'pending' else 'none' end);
  end if;
  v_in := greatest(0, coalesce(p_source_in, 0));
  v_out := coalesce(p_source_out, v_asset.duration, 1e9);
  if v_out <= v_in then
    raise exception 'Choose a longer part of the file.' using errcode = '22023';
  end if;
  v_hash := public.store_transcript_slice(p_clip_id, v_body::jsonb, v_in, v_out);
  return jsonb_build_object('status', 'ready', 'hash', v_hash, 'src', 'assets/transcripts/' || v_hash || '.json');
end;
$$;

revoke all on function public.use_media_transcript(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.use_media_transcript(uuid, uuid, numeric, numeric) to authenticated;

-- Free transcript on demand for a file of the caller's that has none yet (uploaded before
-- automatic transcription, or failed): same eligibility and daily cap as the automatic run.
create or replace function public.request_media_transcript(p_media_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_asset public.media_assets;
begin
  select * into v_asset from public.media_assets
  where id = p_media_id and user_id = v_user and status <> 'rejected' and storage_path like 'media/%';
  if not found then
    raise exception 'This file is not stored with this project. Wait for it to finish uploading.' using errcode = 'P0002';
  end if;
  if v_asset.transcript_status = 'failed' then
    update public.media_assets set transcript_status = 'none' where id = v_asset.id;
  end if;
  return public.queue_asset_transcript(v_asset.id);
end;
$$;

revoke all on function public.request_media_transcript(uuid) from public, anon;
grant execute on function public.request_media_transcript(uuid) to authenticated;

-- Paid captions: a file that already has its transcript is never charged again. A finished task
-- (0 credits) is returned so the inspector's existing polling reads `output.src` unchanged.
create or replace function public.request_media_captions(p_clip_id uuid, p_media_id uuid, p_source_in numeric DEFAULT 0, p_source_out numeric DEFAULT NULL::numeric, p_request_id uuid DEFAULT NULL::uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_clip public.clips;
  v_asset public.media_assets;
  v_in numeric;
  v_out numeric;
  v_credits int;
  v_task public.tasks;
  v_body text;
  v_hash text;
begin
  v_clip := public.owned_clip(p_clip_id, v_user);
  select * into v_asset from public.media_assets
  where id = p_media_id and user_id = v_user and job_id = v_clip.job_id
    and status <> 'rejected' and storage_path like 'media/%';
  if not found then
    raise exception 'This file is not stored with this project. Wait for it to finish uploading.' using errcode = 'P0002';
  end if;
  -- The library says "synced" as soon as the upload ends, before the worker has measured the
  -- file: the client sees "still being processed" (409), waits and calls again.
  if v_asset.status <> 'ready' then
    raise exception 'This file is still being processed. Try again in a moment.' using errcode = 'P0001';
  end if;
  if v_asset.duration is null or v_asset.duration <= 0 then
    raise exception 'This file has no audio to caption.' using errcode = '22023';
  end if;

  v_in := greatest(0, coalesce(p_source_in, 0));
  v_out := least(v_asset.duration, coalesce(p_source_out, v_asset.duration));
  if v_out - v_in < 0.5 then
    raise exception 'Choose a longer part of the file to caption.' using errcode = '22023';
  end if;

  if p_request_id is not null then
    select * into v_task from public.tasks where request_id = p_request_id and user_id = v_user;
    if found then
      return jsonb_build_object('task_id', v_task.id, 'credits', (v_task.payload ->> 'credits')::int);
    end if;
  end if;

  -- Reuse: the file's own transcript, sliced to this window, for free.
  select body into v_body from public.media_transcripts where asset_id = v_asset.id;
  if v_body is not null then
    v_hash := public.store_transcript_slice(p_clip_id, v_body::jsonb, v_in, v_out);
    insert into public.tasks (user_id, kind, clip_id, job_id, asset_id, payload, status, request_id,
                              started_at, finished_at, output)
    values (v_user, 'transcribe_media', p_clip_id, v_clip.job_id, p_media_id,
            jsonb_build_object('source_in', v_in, 'source_out', v_out, 'credits', 0, 'reused', true),
            'done', coalesce(p_request_id, gen_random_uuid()), now(), now(),
            jsonb_build_object('hash', v_hash, 'src', 'assets/transcripts/' || v_hash || '.json'))
    returning * into v_task;
    return jsonb_build_object('task_id', v_task.id, 'credits', 0);
  end if;

  if v_out - v_in > public.captions_max_seconds() then
    raise exception 'Captions work on up to % minutes at a time. Trim the clip first.', public.captions_max_seconds() / 60
      using errcode = '22023';
  end if;
  v_credits := public.captions_credits(v_out - v_in);

  perform public.lock_credit_owner(v_user);
  select * into v_task from public.tasks
  where user_id = v_user and kind = 'transcribe_media' and clip_id = p_clip_id and asset_id = p_media_id
    and status in ('queued', 'running')
    and (payload ->> 'source_in')::numeric = v_in and (payload ->> 'source_out')::numeric = v_out
  limit 1;
  if found then
    return jsonb_build_object('task_id', v_task.id, 'credits', (v_task.payload ->> 'credits')::int);
  end if;

  if public.credit_balance(v_user) < v_credits then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_credits, public.credit_balance(v_user) using errcode = 'P0001';
  end if;
  insert into public.tasks (user_id, kind, clip_id, job_id, asset_id, payload, status, request_id)
  values (v_user, 'transcribe_media', p_clip_id, v_clip.job_id, p_media_id,
          jsonb_build_object('source_in', v_in, 'source_out', v_out, 'credits', v_credits),
          'queued', coalesce(p_request_id, gen_random_uuid()))
  returning * into v_task;
  perform public.credit_hold(v_user, 'captions', v_task.id, v_credits, 'Captions', v_clip.job_id);
  return jsonb_build_object('task_id', v_task.id, 'credits', v_credits);
end;
$$;

commit;
