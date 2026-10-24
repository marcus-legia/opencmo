-- Long take, Task 6 (docs/plans/editor/2026-10-23-ai-long-take-plan.md, F9): a garbled-text hint on generated
-- images. The worker asks a vision model whether the text meant to be read is clean, slightly off or gibberish;
-- the editor badges a severe keyframe ("This keyframe has garbled text. Redo it?").
-- - `generations.quality` (null = not checked), readable by its owner under the existing select policy.
-- - `complete_generation` takes it as `p_quality`. The new parameter has a default, so a worker that does not
--   send it keeps working; deploy this before the worker that sends it, and before the web: the web reads
--   `generations.quality` on every generation read (GENERATION_COLUMNS), so it fails without the column.
-- It never fails a generation and never moves credits.

begin;

alter table public.generations add column if not exists quality jsonb;

create or replace function public.generation_quality_ok(p_quality jsonb) returns boolean
  language sql immutable
  set search_path to 'public'
as $$
  select p_quality is not null
     and jsonb_typeof(p_quality) = 'object'
     and (select count(*) from jsonb_object_keys(p_quality)) = 1
     and p_quality->>'text' in ('none', 'minor', 'severe');
$$;

-- Only the definer RPC and the check constraint use it (both run as the table owner).
revoke execute on function public.generation_quality_ok(jsonb) from public, anon, authenticated;

alter table public.generations drop constraint if exists generations_quality_check;
alter table public.generations add constraint generations_quality_check
  check (quality is null or public.generation_quality_ok(quality));

drop function if exists public.complete_generation(uuid, uuid, text, text, numeric, int, int, int, jsonb);

create function public.complete_generation(p_task_id uuid, p_attempt_id uuid, p_object_name text, p_name text,
  p_duration numeric, p_width integer, p_height integer, p_credits integer, p_words jsonb default null,
  p_quality jsonb default null) returns boolean
  language plpgsql security definer
  set search_path to 'public'
as $function$
declare
  v_task public.tasks;
  v_generation public.generations;
  v_asset public.media_assets;
  v_final int;
  v_words jsonb;
  v_quality jsonb;
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
$function$;

revoke execute on function public.complete_generation(uuid, uuid, text, text, numeric, int, int, int, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.complete_generation(uuid, uuid, text, text, numeric, int, int, int, jsonb, jsonb) to service_role;

commit;
