-- 20261219000000: a clip job needs picked moments (plan item 1, owner decision 8, 2026-10-19).
--
-- AI moment picking is gone from the product: the user picks every moment on the full-size picker.
-- A clip job without `segments` used to fall back to the engine's `select` step (a server model
-- call); it is now refused here before credits are held. zod in `createClipJob` refuses it first
-- and the worker refuses it last (web rule 2); this is the real gate. `p_clips` and `p_length` stay
-- in the signature for old callers, but the clip count is always the number of moments.
-- `mode = 'full'` is unchanged: the whole video, no moments.
--
-- `create_video_pack` (CMO W5) made its clip job without moments for the same `select` step. It
-- now takes the picked moments too (owner, 2026-10-19: video packs are picked by hand) and passes
-- them to `create_job`; the caption step after it is unchanged. A new argument is a new signature,
-- so the old one is dropped and the grants are given again.

begin;

create or replace function public.create_job(p_source_url text, p_clips integer DEFAULT 5, p_length text DEFAULT 'auto'::text, p_segments jsonb DEFAULT NULL::jsonb, p_mode text DEFAULT 'clip'::text, p_aspect text DEFAULT '9:16'::text, p_layout text DEFAULT 'auto'::text, p_captions boolean DEFAULT true, p_caption_preset text DEFAULT 'bold'::text) RETURNS public.jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := public.require_user();
  v_hold int := public.job_hold_credits();
  v_balance int;
  v_plan text;
  v_length text := coalesce(p_length, 'auto');
  v_job public.jobs;
  v_source text := trim(coalesce(p_source_url, ''));
  v_segments jsonb := p_segments;
  v_clips int := p_clips;
  v_mode text := coalesce(p_mode, 'clip');
  v_aspect text := coalesce(p_aspect, '9:16');
  v_layout text := coalesce(p_layout, 'auto');
  v_captions boolean := coalesce(p_captions, true);
  v_preset text := coalesce(p_caption_preset, 'bold');
  v_prev numeric;
  v_item jsonb;
begin
  if v_source = '' then
    raise exception 'Missing video link.' using errcode = '22023';
  end if;
  if v_source not like 'storage://%'
     and (v_source !~* '^https?://[^/@[:space:]]+([/:?#]|$)' or public.video_url_refused(v_source))
  then
    raise exception 'Paste a public HTTP or HTTPS video link.' using errcode = '22023';
  end if;

  if v_mode not in ('clip', 'full') then
    raise exception 'Choose whether to clip the video or download it whole.' using errcode = '22023';
  end if;

  if v_segments is not null and jsonb_typeof(v_segments) = 'array'
     and jsonb_array_length(v_segments) = 0 then
    v_segments := null;
  end if;
  if v_mode = 'full' then
    if v_segments is not null then
      raise exception 'Picked moments only apply when we clip your video.' using errcode = '22023';
    end if;
    v_clips := 1;
  elsif v_segments is null then
    raise exception 'Pick at least one moment to clip.' using errcode = '22023';
  end if;

  if v_segments is not null then
    if jsonb_typeof(v_segments) <> 'array' then
      raise exception 'Pick the moments you want on the timeline.' using errcode = '22023';
    end if;
    if jsonb_array_length(v_segments) > 10 then
      raise exception 'Pick at most 10 moments.' using errcode = '22023';
    end if;

    v_prev := null;
    for v_item in
      select value from jsonb_array_elements(v_segments)
      order by (value ->> 'start')::numeric
    loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or jsonb_typeof(v_item -> 'start') is distinct from 'number'
         or jsonb_typeof(v_item -> 'end') is distinct from 'number' then
        raise exception 'Each moment needs a start and end time.' using errcode = '22023';
      end if;
      if (v_item ->> 'start')::numeric < 0 then
        raise exception 'A moment cannot start before the video does.' using errcode = '22023';
      end if;
      if (v_item ->> 'end')::numeric - (v_item ->> 'start')::numeric < 1 then
        raise exception 'Each moment must be at least 1 second long.' using errcode = '22023';
      end if;
      if (v_item ->> 'end')::numeric - (v_item ->> 'start')::numeric > 180 then
        raise exception 'Each moment must be 3 minutes or shorter.' using errcode = '22023';
      end if;
      if v_prev is not null and (v_item ->> 'start')::numeric < v_prev then
        raise exception 'Your moments overlap. Move them apart and try again.' using errcode = '22023';
      end if;
      v_prev := (v_item ->> 'end')::numeric;
    end loop;

    select jsonb_agg(value order by (value ->> 'start')::numeric)
    into v_segments from jsonb_array_elements(v_segments);
    v_clips := jsonb_array_length(v_segments);
  end if;

  if v_clips < 1 or v_clips > 10 then
    raise exception 'Clip count must be between 1 and 10.' using errcode = '22023';
  end if;
  if v_length not in ('auto', 'short', 'medium', 'long') then
    raise exception 'Choose a clip length.' using errcode = '22023';
  end if;
  if v_aspect not in ('9:16', '1:1', '16:9') then
    raise exception 'Unsupported aspect ratio.' using errcode = '22023';
  end if;
  if v_layout not in ('auto', 'fill', 'fit') then
    raise exception 'Unsupported frame layout.' using errcode = '22023';
  end if;
  if v_preset not in ('bold', 'clean', 'minimal') then
    raise exception 'Unsupported caption style.' using errcode = '22023';
  end if;

  if (select count(*) from public.jobs
      where user_id = v_user and status in ('queued', 'running') and purging_at is null) >= 3
  then
    raise exception 'You already have 3 projects in progress. Please wait for one to finish.'
      using errcode = 'P0001';
  end if;

  if not public.rate_limit_hit('jobs', 10, 3600) then
    raise exception 'Too many projects started. Please wait a while and try again.'
      using errcode = 'P0001';
  end if;

  if v_source like 'storage://%' then
    perform public.consume_upload_reservation('sources', substring(v_source from 11), null);
  end if;

  perform 1 from public.profiles where id = v_user for update;
  v_balance := public.credit_balance(v_user);
  if v_balance < v_hold then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_hold, v_balance using errcode = 'P0001';
  end if;
  select plan into v_plan from public.profiles where id = v_user;

  insert into public.jobs(
    user_id, source_url, clips_requested, clip_length, watermark, segments,
    mode, aspect, layout, captions, caption_preset
  ) values(
    v_user, v_source, v_clips, v_length, coalesce(v_plan, 'free') = 'free', v_segments,
    v_mode, v_aspect, v_layout, v_captions, v_preset
  ) returning * into v_job;

  perform public.credit_hold(v_user, 'job', v_job.id, v_hold, 'Hold for new job', v_job.id);
  return v_job;
end;
$_$;

drop function public.create_video_pack(text, boolean, integer);

create function public.create_video_pack(p_source text, p_confirmed boolean default false, p_clips integer default 5, p_segments jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_source text := trim(coalesce(p_source, ''));
  v_upload boolean := v_source like 'storage://%';
  v_job public.jobs;
  v_run public.cmo_runs;
begin
  if not v_upload and not coalesce(p_confirmed, false) then
    raise exception 'Confirm that this is your own video.' using errcode = '22023';
  end if;
  if exists (select 1 from public.cmo_runs where user_id = v_user and kind = 'video_pack' and status in ('queued', 'running')) then
    raise exception 'Your last video pack is still being made.' using errcode = 'P0001';
  end if;
  -- create_job refuses a clip job without moments and sets the clip count from them.
  v_job := public.create_job(v_source, coalesce(p_clips, 5), 'auto', p_segments, 'clip', '9:16', 'auto', true, 'bold');
  update public.projects set kind = 'video_pack' where job_id = v_job.id;
  insert into public.video_ownership (job_id, user_id, source, url)
  values (v_job.id, v_user, case when v_upload then 'upload' else 'link' end, case when v_upload then null else v_source end);
  v_run := public.cmo_enqueue(v_user, 'video_pack', jsonb_build_object('job_id', v_job.id));
  return jsonb_build_object('job', to_jsonb(v_job), 'run', to_jsonb(v_run));
end;
$$;

revoke all on function public.create_video_pack(text, boolean, integer, jsonb) from public, anon;
grant execute on function public.create_video_pack(text, boolean, integer, jsonb) to authenticated;

commit;
