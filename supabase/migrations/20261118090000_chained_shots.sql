-- Chained shots in /video: a shot may continue the previous one (same scene, no cut). Its spec
-- carries `after` = the parent's spec hash; it waits (`awaiting_input`, never claimed) until the
-- parent is done, then the worker starts it from the parent's last frame. A parent that fails or
-- is cancelled fails its waiting children, which are refunded like any failed generation.
--
-- Functions are copied from the running definitions (r6 credit module, clip-video edit, G1
-- generations); only the commented parts are new.

begin;

alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check
  check (status in ('awaiting_upload', 'awaiting_input', 'queued', 'running', 'done', 'failed', 'cancelled'));

alter table public.generations
  add column after_id uuid references public.generations(id) on delete set null;
create index generations_after_idx on public.generations(after_id) where after_id is not null;

-- ai_check_spec
create or replace function public.ai_check_spec(p_model public.ai_models, p_spec jsonb)
returns void
language plpgsql
stable
set search_path to 'public'
as $$
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
begin
  if v_scene then
    v_allowed := v_allowed || array['scene'];
  end if;
  if p_model.kind in ('image', 'video') then
    if p_model.limits ? 'resolutions' then v_allowed := v_allowed || array['resolution']; end if;
    if v_max_refs > 0 then v_allowed := v_allowed || array['references']; end if;
  end if;
  if p_model.kind = 'video' then
    if coalesce((p_model.limits->>'firstFrame')::boolean, false) then v_allowed := v_allowed || array['startImage', 'after']; end if;
    if coalesce((p_model.limits->>'lastFrame')::boolean, false) then v_allowed := v_allowed || array['endImage']; end if;
    if coalesce((p_model.limits->>'audio')::boolean, false) then v_allowed := v_allowed || array['audio']; end if;
    if v_source then v_allowed := v_allowed || array['sourceVideo', 'sourceStart']; end if;
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
  if v_scene and octet_length((p_spec->'scene')::text) > 4000 then
    raise exception 'This 3D scene has too much data.' using errcode = '22023';
  end if;
  if v_scene and p_spec->'scene'->>'template' = 'code' and (
      jsonb_typeof(p_spec->'scene'->'code_ref') is distinct from 'string'
      or not exists (select 1 from public.scene_codes c
                     where c.user_id = auth.uid() and c.hash = p_spec->'scene'->>'code_ref')) then
    raise exception 'This 3D scene code was not found. Preview it again.' using errcode = '22023';
  end if;
  if p_model.kind = 'voice' and (jsonb_typeof(p_spec->'voice') is distinct from 'string'
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
$$;

-- create_generation
CREATE OR REPLACE FUNCTION public.create_generation(p_job_id uuid, p_clip_id uuid, p_model text, p_spec jsonb, p_spec_hash text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := public.require_user();
  v_model public.ai_models;
  v_generation public.generations;
  v_task public.tasks;
  v_price int;
  v_parent public.generations;
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

  select * into v_generation from public.generations
  where job_id = p_job_id and spec_hash = p_spec_hash and status in ('queued', 'running', 'done');
  if found then
    return jsonb_build_object('generation', to_jsonb(v_generation), 'reused', true);
  end if;

  if (select count(*) from public.generations
      where user_id = v_user and status in ('queued', 'running')) >= public.generation_active_limit() then
    raise exception 'Too many generations are running. Wait for one to finish.' using errcode = 'P0001';
  end if;

  v_price := public.ai_price(v_model, p_spec);
  if public.credit_balance(v_user) < v_price then
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

  insert into public.generations (user_id, job_id, clip_id, kind, model, spec, spec_hash, credits_reserved, after_id)
  values (v_user, p_job_id, p_clip_id, v_model.kind, v_model.id, p_spec, p_spec_hash, v_price, v_parent.id)
  returning * into v_generation;
  insert into public.tasks (user_id, kind, job_id, clip_id, payload, request_id, status)
  values (v_user, 'generate', p_job_id, p_clip_id, jsonb_build_object('generation_id', v_generation.id), p_request_id,
          case when v_parent.id is not null and v_parent.status <> 'done' then 'awaiting_input' else 'queued' end)
  returning * into v_task;
  update public.generations set task_id = v_task.id where id = v_generation.id returning * into v_generation;
  if v_price > 0 then
    perform public.credit_hold(v_user, 'generation', v_generation.id, v_price, 'Generate hold', p_job_id);
  end if;

  return jsonb_build_object('generation', to_jsonb(v_generation), 'reused', false);
end;
$function$
;

-- complete_generation
CREATE OR REPLACE FUNCTION public.complete_generation(p_task_id uuid, p_attempt_id uuid, p_object_name text, p_name text, p_duration numeric, p_width integer, p_height integer, p_credits integer, p_words jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task public.tasks;
  v_generation public.generations;
  v_asset public.media_assets;
  v_final int;
  v_words jsonb;
begin
  select * into v_task from public.tasks
  where id = p_task_id and kind = 'generate' and attempt_id is not distinct from p_attempt_id
  for update;
  if not found then return false; end if;
  select * into v_generation from public.generations where task_id = p_task_id for update;
  if not found then return false; end if;
  if v_task.status = 'done' then
    return v_generation.status = 'done';
  end if;
  if v_task.status <> 'running' then return false; end if;
  -- Đường dẫn do worker tự đặt; kiểm lại để một lỗi ở worker không gắn file của
  -- project khác vào generation này.
  if p_object_name is null
     or p_object_name !~ ('^' || v_task.user_id || '/' || v_task.job_id || '/gen-[0-9a-f-]{36}\.[a-z0-9]{2,5}$') then
    raise exception 'invalid generated object name';
  end if;

  -- Mốc chữ chỉ có nghĩa với giọng đọc. Sai hình dạng thì BỎ, không làm hỏng
  -- lượt sinh đã trả tiền: voiceover vẫn dùng được, chỉ không có phụ đề.
  if v_generation.kind = 'voice' and p_words is not null
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

  insert into public.media_assets (user_id, job_id, storage_path, name, duration, width, height, status, words)
  values (v_task.user_id, v_task.job_id, 'media/' || p_object_name, left(coalesce(nullif(btrim(p_name), ''), 'Generated'), 200),
          p_duration, p_width, p_height, 'ready', v_words)
  returning * into v_asset;

  v_final := least(v_generation.credits_reserved, greatest(coalesce(p_credits, v_generation.credits_reserved), 0));
  update public.generations
  set status = 'done', credits_final = v_final, media_asset_id = v_asset.id, error = null, finished_at = now()
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
$function$
;

-- sync_generation_from_task
CREATE OR REPLACE FUNCTION public.sync_generation_from_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  end if;
  return new;
end;
$function$
;

-- cancel_generation
create or replace function public.cancel_generation(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_generation public.generations;
begin
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
