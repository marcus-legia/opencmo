-- Charge before running (plan 2026-11-06, phase 3): a shot can start and end on keyframes still being made.
--
-- `after` already lets a shot continue the previous shot's last frame. `startAfter` / `endAfter` name the spec
-- hash of a keyframe (an image generation of the same project): the shot waits for every frame it needs, the
-- worker swaps in the finished keyframes, and a failed keyframe fails (refunds) the shots that wait on it. This
-- lets /video create keyframes and shots in one go after one confirmation.

alter table public.generations
  add column if not exists start_after_id uuid references public.generations(id) on delete set null,
  add column if not exists end_after_id uuid references public.generations(id) on delete set null;
create index if not exists generations_start_after_idx on public.generations (start_after_id) where start_after_id is not null;
create index if not exists generations_end_after_idx on public.generations (end_after_id) where end_after_id is not null;

create or replace function public.ai_check_spec(p_model public.ai_models, p_spec jsonb) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $_$
declare
  v_allowed text[] := case p_model.kind
    when 'image' then array['prompt', 'aspectRatio', 'seed']
    when 'video' then array['prompt', 'aspectRatio', 'duration', 'seed']
    when 'voice' then array['prompt', 'voice', 'seed']
    when 'audio' then array['prompt', 'duration', 'seed']
  end;
  v_prompt text;
  v_scene boolean := coalesce((p_model.limits->>'scene')::boolean, false);
  v_max_refs int := coalesce((p_model.limits->>'maxReferences')::int, 0);
  v_source boolean := coalesce((p_model.limits->>'sourceVideo')::boolean, false);
  -- A narrated video (explainer) takes a voice, like a voiceover.
  v_voiced boolean := p_model.kind = 'voice' or (p_model.kind = 'video' and p_model.limits ? 'voices');
  v_explainer boolean := p_model.provider = 'opencmo-motion';
  -- The scene template a motion model renders: narrated explainers take voices, silent clips do not.
  v_template text := case when p_model.provider = 'opencmo-motion'
    then case when p_model.limits ? 'voices' then 'explainer' else 'clip' end end;
  v_beat jsonb;
  v_seconds numeric := 0;
begin
  if v_scene then
    v_allowed := v_allowed || array['scene'];
  end if;
  if p_model.kind in ('image', 'video') then
    if p_model.limits ? 'resolutions' then v_allowed := v_allowed || array['resolution']; end if;
    if v_max_refs > 0 then v_allowed := v_allowed || array['references']; end if;
  end if;
  if p_model.kind = 'video' then
    if coalesce((p_model.limits->>'firstFrame')::boolean, false) then v_allowed := v_allowed || array['startImage', 'after', 'startAfter']; end if;
    if coalesce((p_model.limits->>'lastFrame')::boolean, false) then v_allowed := v_allowed || array['endImage', 'endAfter']; end if;
    if coalesce((p_model.limits->>'audio')::boolean, false) then v_allowed := v_allowed || array['audio']; end if;
    if v_source then v_allowed := v_allowed || array['sourceVideo', 'sourceStart']; end if;
    if v_voiced then v_allowed := v_allowed || array['voice']; end if;
  end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'Invalid generation request.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_spec) k where k <> all (v_allowed)) then
    raise exception 'This request has settings the model does not take.' using errcode = '22023';
  end if;
  v_prompt := case when jsonb_typeof(p_spec->'prompt') = 'string' then p_spec->>'prompt' end;
  if v_prompt is null or btrim(v_prompt) = '' then
    raise exception 'Write a prompt first.' using errcode = '22023';
  end if;
  if length(v_prompt) > (p_model.limits->>'maxPromptChars')::int then
    raise exception 'Keep the prompt under % characters.', p_model.limits->>'maxPromptChars' using errcode = '22023';
  end if;
  if p_spec ? 'seed' and (jsonb_typeof(p_spec->'seed') <> 'number'
      or (p_spec->>'seed')::numeric <> trunc((p_spec->>'seed')::numeric)
      or (p_spec->>'seed')::numeric not between 0 and 2147483647) then
    raise exception 'Invalid seed.' using errcode = '22023';
  end if;
  if p_model.kind in ('image', 'video') and (jsonb_typeof(p_spec->'aspectRatio') is distinct from 'string'
      or not coalesce(p_model.limits->'aspectRatios' ? (p_spec->>'aspectRatio'), false)) then
    raise exception '% does not support that aspect ratio.', p_model.name using errcode = '22023';
  end if;
  if p_model.kind = 'video' and (jsonb_typeof(p_spec->'duration') is distinct from 'number'
      or not (p_model.limits->'durations') @> jsonb_build_array(p_spec->'duration')) then
    raise exception '% does not support that duration.', p_model.name using errcode = '22023';
  end if;
  if p_spec ? 'resolution' and (jsonb_typeof(p_spec->'resolution') is distinct from 'string'
      or not coalesce(p_model.limits->'resolutions' ? (p_spec->>'resolution'), false)) then
    raise exception '% does not support that resolution.', p_model.name using errcode = '22023';
  end if;
  if p_spec ? 'audio' and jsonb_typeof(p_spec->'audio') is distinct from 'boolean' then
    raise exception 'Invalid generation request.' using errcode = '22023';
  end if;
  -- A shot that continues the previous one (/video): `after` is the parent's spec hash; the
  -- worker starts it from the parent's last frame, so it cannot also start from an image.
  if p_spec ? 'after' and (jsonb_typeof(p_spec->'after') is distinct from 'string'
      or p_spec->>'after' !~ '^[0-9a-f]{64}$') then
    raise exception 'Invalid generation request.' using errcode = '22023';
  end if;
  if p_spec ? 'after' and p_spec ? 'startImage' then
    raise exception 'A shot that continues the previous one cannot also start from an image.' using errcode = '22023';
  end if;
  -- A shot that starts or ends on a keyframe still being made (/video in one go): the keyframe's spec hash. The
  -- worker swaps in the finished keyframe, so the shot cannot also name an image for the same end.
  if (p_spec ? 'startAfter' and (jsonb_typeof(p_spec->'startAfter') is distinct from 'string'
        or p_spec->>'startAfter' !~ '^[0-9a-f]{64}$'))
      or (p_spec ? 'endAfter' and (jsonb_typeof(p_spec->'endAfter') is distinct from 'string'
        or p_spec->>'endAfter' !~ '^[0-9a-f]{64}$')) then
    raise exception 'Invalid generation request.' using errcode = '22023';
  end if;
  if p_spec ? 'startAfter' and (p_spec ? 'startImage' or p_spec ? 'after') then
    raise exception 'A shot starts from one frame only.' using errcode = '22023';
  end if;
  if p_spec ? 'endAfter' and p_spec ? 'endImage' then
    raise exception 'A shot ends on one frame only.' using errcode = '22023';
  end if;
  if (p_spec ? 'startImage' and not public.ai_media_ref_ok(p_spec->'startImage'))
      or (p_spec ? 'endImage' and not public.ai_media_ref_ok(p_spec->'endImage')) then
    raise exception 'That image was not found in your library.' using errcode = '22023';
  end if;
  -- Video-to-video: the source is required and the caller's own. Background removal and the
  -- edit models flagged `clipVideo` may also read the clip's own video (`renders:` / `sources:`);
  -- upscale only library files.
  if v_source then
    if not (p_spec ? 'sourceVideo') or not (
        public.ai_media_ref_ok(p_spec->'sourceVideo')
        or ((coalesce((p_model.limits->>'removeBackground')::boolean, false)
             or coalesce((p_model.limits->>'clipVideo')::boolean, false))
            and public.ai_clip_video_ref_ok(p_spec->'sourceVideo'))) then
      raise exception 'Choose a video from your library to edit.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_spec->'sourceStart') is distinct from 'number' or (p_spec->>'sourceStart')::numeric < 0 then
      raise exception 'Invalid generation request.' using errcode = '22023';
    end if;
  end if;
  if p_spec ? 'references' then
    if jsonb_typeof(p_spec->'references') is distinct from 'array'
        or jsonb_array_length(p_spec->'references') not between 1 and v_max_refs then
      raise exception '% takes up to % reference images.', p_model.name, v_max_refs using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_spec->'references') r where not public.ai_media_ref_ok(r)) then
      raise exception 'That image was not found in your library.' using errcode = '22023';
    end if;
  end if;
  if v_scene and (jsonb_typeof(p_spec->'scene') is distinct from 'object'
      or jsonb_typeof(p_spec->'scene'->'template') is distinct from 'string') then
    raise exception 'Describe the 3D scene first.' using errcode = '22023';
  end if;
  if v_scene and octet_length((case when v_explainer then (p_spec->'scene') - 'assets' else p_spec->'scene' end)::text) > 4000 then
    raise exception 'This 3D scene has too much data.' using errcode = '22023';
  end if;
  -- Explainers: the explainer model takes only explainer scenes, and only it takes them. The
  -- script is checked here because the price and the voice are computed from it.
  if v_scene and v_explainer and p_spec->'scene'->>'template' is distinct from v_template then
    if v_template = 'clip' then
      raise exception 'This motion clip is not valid. Write it again.' using errcode = '22023';
    end if;
    raise exception 'This explainer script is not valid. Write it again.' using errcode = '22023';
  end if;
  if v_scene and not v_explainer and p_spec->'scene'->>'template' in ('explainer', 'clip') then
    raise exception 'Describe the 3D scene first.' using errcode = '22023';
  end if;
  if v_explainer and (
      jsonb_typeof(p_spec->'scene'->'code_ref') is distinct from 'string'
      or not exists (select 1 from public.scene_codes c
                     where c.user_id = auth.uid() and c.hash = p_spec->'scene'->>'code_ref')) then
    raise exception 'This explainer code was not found. Preview it again.' using errcode = '22023';
  end if;
  if v_explainer and (
      jsonb_typeof(p_spec->'scene'->'title') is distinct from 'string'
      or length(btrim(p_spec->'scene'->>'title')) not between 1 and 60
      or jsonb_typeof(p_spec->'scene'->'beats') is distinct from 'array'
      -- Explainers: 3-16 narrated beats; silent clips (motion quality B1): 1-8 timed beats.
      or jsonb_array_length(p_spec->'scene'->'beats') not between
         case v_template when 'clip' then 1 else 3 end and case v_template when 'clip' then 8 else 16 end
      or (p_spec->'scene' ? 'accent' and (jsonb_typeof(p_spec->'scene'->'accent') is distinct from 'string'
          or p_spec->'scene'->>'accent' !~ '^#[0-9a-fA-F]{6}$'))
      -- v2: the look and the motion personality, the same names as `THEMES` and
      -- `PERSONALITIES` in packages/clip-motion/src/job.ts. Both optional.
      or (p_spec->'scene' ? 'theme' and (jsonb_typeof(p_spec->'scene'->'theme') is distinct from 'string'
          or p_spec->'scene'->>'theme' not in ('blueprint', 'paper')))
      or (p_spec->'scene' ? 'personality' and (jsonb_typeof(p_spec->'scene'->'personality') is distinct from 'string'
          or p_spec->'scene'->>'personality' not in ('premium', 'corporate', 'playful', 'energetic')))) then
    if v_template = 'clip' then
      raise exception 'This motion clip is not valid. Write it again.' using errcode = '22023';
    end if;
    raise exception 'This explainer script is not valid. Write it again.' using errcode = '22023';
  end if;
  if v_template = 'explainer' then
    for v_beat in select b from jsonb_array_elements(p_spec->'scene'->'beats') b loop
      if jsonb_typeof(v_beat) is distinct from 'object'
          or exists (select 1 from jsonb_object_keys(v_beat) k where k not in ('say', 'label'))
          or jsonb_typeof(v_beat->'say') is distinct from 'string'
          or length(btrim(v_beat->>'say')) not between 1 and 240
          or (v_beat ? 'label' and (jsonb_typeof(v_beat->'label') is distinct from 'string'
              or length(btrim(v_beat->>'label')) > 40)) then
        raise exception 'This explainer script is not valid. Write it again.' using errcode = '22023';
      end if;
    end loop;
  end if;
  -- A silent clip: every beat says how long it lasts (0.5-30 s), and they add up to at most 30 s and
  -- to no more than the paid duration.
  if v_template = 'clip' then
    for v_beat in select b from jsonb_array_elements(p_spec->'scene'->'beats') b loop
      if jsonb_typeof(v_beat) is distinct from 'object'
          or exists (select 1 from jsonb_object_keys(v_beat) k where k not in ('say', 'label', 'seconds'))
          or jsonb_typeof(v_beat->'say') is distinct from 'string'
          or length(btrim(v_beat->>'say')) not between 1 and 240
          or (v_beat ? 'label' and (jsonb_typeof(v_beat->'label') is distinct from 'string'
              or length(btrim(v_beat->>'label')) > 40))
          or jsonb_typeof(v_beat->'seconds') is distinct from 'number'
          or (v_beat->>'seconds')::numeric not between 0.5 and 30 then
        raise exception 'This motion clip is not valid. Write it again.' using errcode = '22023';
      end if;
      v_seconds := v_seconds + (v_beat->>'seconds')::numeric;
    end loop;
    if v_seconds > 30 then
      raise exception 'This motion clip is longer than 30 seconds. Shorten its beats.' using errcode = '22023';
    end if;
    if v_seconds > (p_spec->>'duration')::numeric then
      raise exception 'This motion clip''s beats last longer than its paid length. Shorten its beats or make it longer.' using errcode = '22023';
    end if;
  end if;
  -- Images the scene shows (kit.Image): at most 6, each the caller's own library object
  -- (motion quality A5). The worker checks them again against the task's owner.
  if v_explainer and p_spec->'scene' ? 'assets'
      and not public.ai_motion_assets_ok(p_spec->'scene'->'assets') then
    raise exception 'An image in this animation is not in your library. Pick it again.' using errcode = '22023';
  end if;
  if v_scene and p_spec->'scene'->>'template' = 'code' and (
      jsonb_typeof(p_spec->'scene'->'code_ref') is distinct from 'string'
      or not exists (select 1 from public.scene_codes c
                     where c.user_id = auth.uid() and c.hash = p_spec->'scene'->>'code_ref')) then
    raise exception 'This 3D scene code was not found. Preview it again.' using errcode = '22023';
  end if;
  if v_voiced and (jsonb_typeof(p_spec->'voice') is distinct from 'string'
      or not coalesce(p_model.limits->'voices' ? (p_spec->>'voice'), false)) then
    raise exception 'Choose one of the listed voices.' using errcode = '22023';
  end if;
  if p_model.kind = 'audio' and (jsonb_typeof(p_spec->'duration') is distinct from 'number'
      or (p_spec->>'duration')::numeric <> trunc((p_spec->>'duration')::numeric)
      or (p_spec->>'duration')::numeric not between (p_model.limits->>'minSeconds')::numeric
                                             and (p_model.limits->>'maxSeconds')::numeric) then
    raise exception 'Sounds are % to % seconds long.', p_model.limits->>'minSeconds', p_model.limits->>'maxSeconds'
      using errcode = '22023';
  end if;
end;
$_$;


create or replace function public.create_generation(p_job_id uuid, p_clip_id uuid, p_model text, p_spec jsonb, p_spec_hash text, p_request_id uuid, p_order_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := public.require_user();
  v_model public.ai_models;
  v_generation public.generations;
  v_task public.tasks;
  v_price int;
  v_parent public.generations;
  v_order public.credit_orders;
  v_start public.generations;
  v_end public.generations;
  v_waits boolean;
begin
  if p_request_id is null then
    raise exception 'Missing request id.' using errcode = '22023';
  end if;
  if p_spec_hash is null or p_spec_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid generation request.' using errcode = '22023';
  end if;
  -- Khoá theo người dùng: kiểm số dư, trần đang chạy và trùng hash phải đọc
  -- một trạng thái mà hai request song song không cùng thấy.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 2905));

  -- Gửi lại cùng request id (mạng rớt sau khi server đã ghi) → trả lại đúng lượt đó.
  select g.* into v_generation from public.generations g
  join public.tasks t on t.id = g.task_id
  where t.request_id = p_request_id and g.user_id = v_user;
  if found then
    return jsonb_build_object('generation', to_jsonb(v_generation), 'reused', true);
  end if;
  if exists (select 1 from public.tasks where request_id = p_request_id) then
    raise exception 'That request id was already used.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.jobs
    where id = p_job_id and user_id = v_user and purging_at is null
  ) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_clip_id is not null and not exists (
    select 1 from public.clips where id = p_clip_id and job_id = p_job_id
  ) then
    raise exception 'Clip not found.' using errcode = 'P0002';
  end if;

  select * into v_model from public.ai_models where id = p_model and enabled;
  if not found then
    raise exception 'This model is not available.' using errcode = '22023';
  end if;
  perform public.ai_check_spec(v_model, p_spec);

  -- A finished generation whose file was deleted from the library cannot be reused: Retry would
  -- return it forever, with no file. Its hash is retired (still 64 hex characters) so a new one can
  -- be made; a shot continuing it then waits for the new one like for any parent.
  update public.generations
  set spec_hash = encode(sha256(convert_to(spec_hash || ':retired:' || id::text, 'UTF8')), 'hex')
  where job_id = p_job_id and spec_hash = p_spec_hash and status = 'done' and media_asset_id is null;

  select * into v_generation from public.generations
  where job_id = p_job_id and spec_hash = p_spec_hash and status in ('queued', 'running', 'done');
  if found then
    return jsonb_build_object('generation', to_jsonb(v_generation), 'reused', true);
  end if;

  -- New generations only (reuse returned above): each one runs a paid prompt check on the worker, and a
  -- blocked prompt is refunded in full, so the web's `generations` limit alone left a free loop open.
  if not public.rate_limit_hit('generation_create', 120, 3600) then
    raise exception 'Too many generations started. Wait a while and try again.' using errcode = 'P0001';
  end if;

  if (select count(*) from public.generations
      where user_id = v_user and status in ('queued', 'running')) >= public.generation_active_limit() then
    raise exception 'Too many generations are running. Wait for one to finish.' using errcode = 'P0001';
  end if;

  v_price := public.ai_price(v_model, p_spec);
  if p_order_id is not null then
    -- Part of a job the user confirmed once (charge before running): its price comes out of the job's
    -- hold, never out of a balance that may have been spent since the confirmation.
    select * into v_order from public.credit_orders where id = p_order_id and user_id = v_user;
    if not found then
      raise exception 'Job not found.' using errcode = 'P0002';
    end if;
    if v_order.status <> 'open' then
      raise exception 'This job is closed. Start it again.' using errcode = 'P0001';
    end if;
    if public.credit_held('credit_order', v_order.id) < v_price then
      raise exception 'This job needs more credits than its estimate. Start it again.' using errcode = 'P0001';
    end if;
  elsif public.credit_balance(v_user) < v_price then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_price, public.credit_balance(v_user) using errcode = 'P0001';
  end if;

  -- A shot that continues another (`after`) waits for it: same project and owner, still live.
  -- The row lock orders this against `complete_generation`, which releases waiting children.
  if p_spec ? 'after' then
    select * into v_parent from public.generations
    where job_id = p_job_id and user_id = v_user and spec_hash = p_spec->>'after'
      and status in ('queued', 'running', 'done')
    for update;
    if not found then
      raise exception 'Start the shot before this one first.' using errcode = '22023';
    end if;
  end if;

  -- A shot on keyframes still being made waits for them: same project and owner, images, still live.
  if p_spec ? 'startAfter' then
    select * into v_start from public.generations
    where job_id = p_job_id and user_id = v_user and spec_hash = p_spec->>'startAfter' and kind = 'image'
      and status in ('queued', 'running', 'done')
    for update;
    if not found then
      raise exception 'Start the keyframes of this shot first.' using errcode = '22023';
    end if;
  end if;
  if p_spec ? 'endAfter' then
    select * into v_end from public.generations
    where job_id = p_job_id and user_id = v_user and spec_hash = p_spec->>'endAfter' and kind = 'image'
      and status in ('queued', 'running', 'done')
    for update;
    if not found then
      raise exception 'Start the keyframes of this shot first.' using errcode = '22023';
    end if;
  end if;
  v_waits := (v_parent.id is not null and v_parent.status <> 'done')
    or (v_start.id is not null and v_start.status <> 'done')
    or (v_end.id is not null and v_end.status <> 'done');

  insert into public.generations (user_id, job_id, clip_id, kind, model, spec, spec_hash, credits_reserved, after_id,
                                  start_after_id, end_after_id)
  values (v_user, p_job_id, p_clip_id, v_model.kind, v_model.id, p_spec, p_spec_hash, v_price, v_parent.id,
          v_start.id, v_end.id)
  returning * into v_generation;
  insert into public.tasks (user_id, kind, job_id, clip_id, payload, request_id, status)
  values (v_user, 'generate', p_job_id, p_clip_id, jsonb_build_object('generation_id', v_generation.id), p_request_id,
          case when v_waits then 'awaiting_input' else 'queued' end)
  returning * into v_task;
  update public.generations set task_id = v_task.id where id = v_generation.id returning * into v_generation;
  if v_price > 0 and v_order.id is not null then
    perform public.credit_order_draw(v_order.id, 'generation', v_generation.id, v_price, 'Generate hold', p_job_id);
  elsif v_price > 0 then
    perform public.credit_hold(v_user, 'generation', v_generation.id, v_price, 'Generate hold', p_job_id);
  end if;

  return jsonb_build_object('generation', to_jsonb(v_generation), 'reused', false);
end;
$_$;


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
  -- Shots that continue this one, or start or end on this keyframe, can start once every frame they wait on is
  -- done; the worker's sweep claims them.
  update public.tasks set status = 'queued'
  where status = 'awaiting_input'
    and id in (
      select g.task_id from public.generations g
      where v_generation.id in (g.after_id, g.start_after_id, g.end_after_id)
        and not exists (
          select 1 from public.generations p
          where p.id in (g.after_id, g.start_after_id, g.end_after_id) and p.status <> 'done'
        )
    );
  return true;
end;
$_$;


create or replace function public.sync_generation_from_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_generation public.generations;
begin
  if new.kind <> 'generate' or new.status is not distinct from old.status then
    return new;
  end if;
  select * into v_generation from public.generations where task_id = new.id for update;
  if not found or v_generation.status in ('done', 'failed', 'cancelled') then
    return new;
  end if;
  if new.status = 'running' then
    update public.generations set status = 'running' where id = v_generation.id;
  elsif new.status = 'queued' then
    update public.generations set status = 'queued' where id = v_generation.id;
  elsif new.status = 'cancelled' and v_generation.sent_at is not null then
    -- The worker sent the paid request (`mark_generation_sent`, right before the provider call):
    -- cancelling stops the result, not the bill. Until then nothing was paid, so a cancel while the
    -- worker downloads or checks inputs is refunded below, and so is one after a reclaim that never
    -- reached the provider; a reclaimed task that had reached it keeps its credits even when queued.
    update public.generations
    set status = 'cancelled',
        credits_final = greatest(public.credit_held('generation', v_generation.id), 0),
        error = null,
        finished_at = now()
    where id = v_generation.id;
    update public.tasks
    set status = 'failed', error = 'The shot before this one did not finish. Your credits were refunded.',
        finished_at = now()
    where status = 'awaiting_input'
      and id in (select task_id from public.generations where after_id = v_generation.id);
    update public.tasks
    set status = 'failed', error = 'A keyframe of this shot did not finish. Your credits were refunded.',
        finished_at = now()
    where status = 'awaiting_input'
      and id in (select task_id from public.generations where v_generation.id in (start_after_id, end_after_id));
  elsif new.status in ('failed', 'cancelled') then
    update public.generations
    set status = new.status,
        credits_final = 0,
        -- Lỗi chung của vòng lặp worker và của reclaim nói về "Rendering";
        -- người dùng đang sinh media, không render — thay bằng câu đúng việc.
        error = case when new.status = 'failed' then
          case when new.error is null or new.error ilike 'Rendering%'
            then 'Generation failed. Your credits were refunded.'
            else left(new.error, 500) end
        end,
        finished_at = now()
    where id = v_generation.id;
    perform public.credit_refund(v_generation.user_id, 'generation', v_generation.id, 'Generate refund', v_generation.job_id);
    -- Shots waiting to continue this one can never start: fail them too. Each runs this
    -- trigger in turn, so they are refunded and their own children follow.
    update public.tasks
    set status = 'failed', error = 'The shot before this one did not finish. Your credits were refunded.',
        finished_at = now()
    where status = 'awaiting_input'
      and id in (select task_id from public.generations where after_id = v_generation.id);
    update public.tasks
    set status = 'failed', error = 'A keyframe of this shot did not finish. Your credits were refunded.',
        finished_at = now()
    where status = 'awaiting_input'
      and id in (select task_id from public.generations where v_generation.id in (start_after_id, end_after_id));
  end if;
  return new;
end;
$$;

