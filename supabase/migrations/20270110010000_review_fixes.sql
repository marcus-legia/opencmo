-- Fixes from the review of the charge-before-running work (2026-11-06).
--
-- 1. Lock order: create_generation locked a shot's keyframe rows (FOR UPDATE) before the credit owner, while
--    complete_generation takes the credit owner first, then the generation. A keyframe finishing while its shot
--    was being created could deadlock (40P01) and fail the video. create_generation now takes the owner first.
-- 2. An explainer job belongs to the clip it was approved for: `subject` names it, and preview/add_explainer only
--    draw from the job of their own clip and turn.
-- 3. The plan_explainer card promises "writing and checking, up to agent_3d_hold_credits()": a turn that opened an
--    explainer job is charged at most that for its tokens.

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
  -- One lock per user: the balance, the running cap and a duplicate hash must be read from one state that two
  -- parallel requests cannot both see.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 2905));
  -- The credit owner before any generation row (keyframes, the shot it continues), the order complete_generation
  -- takes them in.
  perform public.lock_credit_owner(v_user);
  -- The same request id again (the network dropped after the server wrote it) gets that generation back.
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



-- ---------------------------------------------------------------- 2. an explainer job names its clip
alter table public.credit_orders add column subject text check (subject is null or length(subject) <= 200);
create index credit_orders_subject_idx on public.credit_orders (user_id, kind, subject) where status = 'open';

drop function public.credit_order_open(text, integer, text, uuid, uuid);
create function public.credit_order_open(p_kind text, p_estimate integer, p_source_kind text, p_source_id uuid, p_request_id uuid, p_subject text default null)
returns public.credit_orders
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.require_user();
  v_order public.credit_orders;
begin
  if p_request_id is null then
    raise exception 'Missing request id.' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('long_take', 'explainer', 'studio_video') then
    raise exception 'Invalid job.' using errcode = '22023';
  end if;
  if p_estimate is null or p_estimate <= 0 or p_estimate > 5000 then
    raise exception 'Invalid job estimate.' using errcode = '22023';
  end if;
  if p_source_kind is not null and p_source_kind not in ('agent_turn', 'work_order', 'mcp') then
    raise exception 'Invalid job.' using errcode = '22023';
  end if;
  if p_subject is not null and length(p_subject) > 200 then
    raise exception 'Invalid job.' using errcode = '22023';
  end if;
  if p_source_kind = 'agent_turn' and not exists (
    select 1 from public.agent_turns t join public.agent_sessions s on s.id = t.session_id
    where t.id = p_source_id and s.user_id = v_user
  ) then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if p_source_kind = 'work_order' and not exists (
    select 1 from public.work_orders where id = p_source_id and user_id = v_user
  ) then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  perform public.lock_credit_owner(v_user);
  select * into v_order from public.credit_orders where request_id = p_request_id;
  if found then
    if v_order.user_id <> v_user then
      raise exception 'That request id was already used.' using errcode = '22023';
    end if;
    return v_order;
  end if;
  insert into public.credit_orders (user_id, kind, estimate_credits, source_kind, source_id, request_id, subject)
  values (v_user, p_kind, p_estimate, p_source_kind, p_source_id, p_request_id, p_subject)
  returning * into v_order;
  perform public.credit_hold(v_user, 'credit_order', v_order.id, p_estimate, 'Job hold');
  return v_order;
end;
$$;
revoke all on function public.credit_order_open(text, integer, text, uuid, uuid, text) from public, anon;
grant execute on function public.credit_order_open(text, integer, text, uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 3. an explainer turn's tokens are capped
create or replace function public.agent_close_turn(p_turn_id uuid, p_status text, p_error text) RETURNS public.agent_turns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_turn public.agent_turns;
  v_user uuid;
  v_credits int;
begin
  select s.user_id into v_user from public.agent_turns t
  join public.agent_sessions s on s.id = t.session_id where t.id = p_turn_id;
  perform public.lock_credit_owner(v_user);

  select * into v_turn from public.agent_turns where id = p_turn_id for update;
  if v_turn.status not in ('running', 'awaiting_browser', 'awaiting_approval', 'awaiting_input', 'awaiting_continue') then
    return v_turn;
  end if;

  -- Every credit used is billed (owner, 2026-11-05): a step that ran past the hold (a long answer, a
  -- sub-agent) is charged too, up to what the user has. The hold is the gate between steps, not a cap.
  select least(public.agent_credits(coalesce(sum(u.micro_usd), 0)::bigint),
               v_turn.hold_credits + greatest(public.credit_balance(v_user), 0))
    into v_credits
  from public.agent_usage u where u.turn_id = p_turn_id;
  -- An approved explainer quoted its writing and checking as "up to agent_3d_hold_credits()": past that, it is ours.
  if exists (select 1 from public.credit_orders o
             where o.source_kind = 'agent_turn' and o.source_id = p_turn_id and o.kind = 'explainer') then
    v_credits := least(v_credits, public.agent_3d_hold_credits());
  end if;

  -- The unused part of the hold comes back; usage past it is charged from the balance.
  perform public.credit_settle(v_user, 'agent_turn', v_turn.id, v_credits, 'Assistant refund');

  update public.agent_tool_calls set status = 'failed', result = '{"summary":"Not completed"}'::jsonb
  where turn_id = p_turn_id and status = 'pending';

  update public.agent_turns
  set status = p_status, pause_reason = null, error = left(p_error, 500), credits = v_credits, finished_at = now()
  where id = p_turn_id returning * into v_turn;

  update public.agent_sessions set lock_until = null, updated_at = now()
  where id = v_turn.session_id;
  return v_turn;
end;
$$;


-- The same cap for usage recorded after the turn closed (a call cut short by Stop).
create or replace function public.agent_record_usage_for(p_user uuid, p_turn_id uuid, p_model text, p_input integer, p_output integer, p_cache_read integer, p_cache_write integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_total bigint;
  v_turn public.agent_turns;
  v_credits int;
begin
  perform public.agent_owned_turn(p_turn_id, p_user);
  if least(p_input, p_output, p_cache_read, p_cache_write) < 0 then
    raise exception 'Invalid usage.' using errcode = '22023';
  end if;
  -- Same lock as agent_close_turn: a close either counts this row or sees the turn closed after it.
  perform public.lock_credit_owner(p_user);
  insert into public.agent_usage(turn_id, model, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, micro_usd)
  values (p_turn_id, left(coalesce(p_model, 'unknown'), 64), p_input, p_output, p_cache_read, p_cache_write,
    public.agent_micro_usd(p_model, p_input, p_output, p_cache_read, p_cache_write));
  select coalesce(sum(micro_usd), 0)::bigint into v_total from public.agent_usage where turn_id = p_turn_id;

  select * into v_turn from public.agent_turns where id = p_turn_id for update;
  if v_turn.status not in ('running', 'awaiting_browser', 'awaiting_approval', 'awaiting_input', 'awaiting_continue') then
    -- Already settled: charge what this usage adds, never past the balance (the hold was given back at
    -- the close and may be spent since). Not capped at the hold any more (owner, 2026-11-05).
    v_credits := public.agent_credits(v_total);
    if exists (select 1 from public.credit_orders o
               where o.source_kind = 'agent_turn' and o.source_id = p_turn_id and o.kind = 'explainer') then
      v_credits := least(v_credits, public.agent_3d_hold_credits());
    end if;
    if v_credits > coalesce(v_turn.credits, 0) then
      v_credits := coalesce(v_turn.credits, 0)
        + least(v_credits - coalesce(v_turn.credits, 0), greatest(public.credit_balance(p_user), 0));
      perform public.credit_settle(p_user, 'agent_turn', p_turn_id, v_credits, 'Assistant usage after Stop');
      update public.agent_turns set credits = v_credits where id = p_turn_id;
    end if;
  end if;
  return public.agent_credits(v_total);
end;
$$;
