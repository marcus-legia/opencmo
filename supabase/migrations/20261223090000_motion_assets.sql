-- Motion quality A5 (docs/plans/editor/2026-10-22-motion-quality-plan.md): a motion scene may show the
-- user's own images through kit.Image. `scene.assets` is a list of at most 6 `{name, ref}`, each `ref` an
-- object of the caller's in the `media` bucket (same rule as a generation's start image). The rule lives in
-- its own function so later redefinitions of `ai_check_spec` keep it with one call.

create or replace function public.ai_motion_assets_ok(p_assets jsonb)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select jsonb_typeof(p_assets) = 'array'
     and jsonb_array_length(p_assets) <= 6
     and not exists (
       select 1 from jsonb_array_elements(p_assets) a
       where jsonb_typeof(a) is distinct from 'object'
          or exists (select 1 from jsonb_object_keys(a) k where k not in ('name', 'ref'))
          or jsonb_typeof(a->'name') is distinct from 'string'
          or a->>'name' !~ '^[a-z][a-z0-9-]{0,31}$'
          or not public.ai_media_ref_ok(a->'ref'))
     and (select count(distinct a->>'name') from jsonb_array_elements(p_assets) a) = jsonb_array_length(p_assets);
$$;

revoke execute on function public.ai_motion_assets_ok(jsonb) from public, anon, authenticated;

create or replace function public.ai_check_spec(p_model public.ai_models, p_spec jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  v_beat jsonb;
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
  -- Explainers: the explainer model takes only explainer scenes, and only it takes them. The
  -- script is checked here because the price and the voice are computed from it.
  if v_scene and v_explainer <> (p_spec->'scene'->>'template' = 'explainer') then
    if v_explainer then
      raise exception 'This explainer script is not valid. Write it again.' using errcode = '22023';
    end if;
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
      or jsonb_array_length(p_spec->'scene'->'beats') not between 3 and 16
      or (p_spec->'scene' ? 'accent' and (jsonb_typeof(p_spec->'scene'->'accent') is distinct from 'string'
          or p_spec->'scene'->>'accent' !~ '^#[0-9a-fA-F]{6}$'))
      -- v2: the look and the motion personality, the same names as `THEMES` and
      -- `PERSONALITIES` in packages/clip-motion/src/job.ts. Both optional.
      or (p_spec->'scene' ? 'theme' and (jsonb_typeof(p_spec->'scene'->'theme') is distinct from 'string'
          or p_spec->'scene'->>'theme' not in ('blueprint', 'paper')))
      or (p_spec->'scene' ? 'personality' and (jsonb_typeof(p_spec->'scene'->'personality') is distinct from 'string'
          or p_spec->'scene'->>'personality' not in ('premium', 'corporate', 'playful', 'energetic')))) then
    raise exception 'This explainer script is not valid. Write it again.' using errcode = '22023';
  end if;
  if v_explainer then
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
$function$;
