-- Charge before running (plan 2026-11-06, phase 2): one hold per job.
--
-- A job the user confirms once (a /video, an explainer, a Studio video) holds its whole estimate up front in a
-- `credit_orders` row. Each paid piece then MOVES its price from the job's hold to its own hold (`credit_order_draw`),
-- so the balance does not move again and every existing settle and refund path (a generation that fails, is blocked
-- or cancelled) works unchanged. Closing the job gives back what it still holds.

create table public.credit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('long_take', 'explainer', 'studio_video')),
  estimate_credits integer not null check (estimate_credits > 0 and estimate_credits <= 5000),
  source_kind text check (source_kind in ('agent_turn', 'work_order', 'mcp')),
  source_id uuid,
  request_id uuid not null unique,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index credit_orders_open_idx on public.credit_orders (created_at) where status = 'open';
create index credit_orders_user_idx on public.credit_orders (user_id, created_at desc);
alter table public.credit_orders enable row level security;
create policy credit_orders_own on public.credit_orders for select to authenticated using (user_id = auth.uid());
revoke all on public.credit_orders from anon, authenticated;
grant select on public.credit_orders to authenticated;
grant select, insert, update, delete on public.credit_orders to service_role;

alter table public.credit_ledger drop constraint if exists credit_ledger_ref_kind_check;
alter table public.credit_ledger add constraint credit_ledger_ref_kind_check check (ref_kind = any (array[
  'job', 'job_fee', 'generation', 'captions', 'caption_translation', 'agent_turn', 'cmo_run', 'work_order', 'credit_order'
]));

-- Opens a job: holds the whole estimate once. The same request id hands back the same job (a retried click).
create or replace function public.credit_order_open(p_kind text, p_estimate integer, p_source_kind text, p_source_id uuid, p_request_id uuid)
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
  insert into public.credit_orders (user_id, kind, estimate_credits, source_kind, source_id, request_id)
  values (v_user, p_kind, p_estimate, p_source_kind, p_source_id, p_request_id)
  returning * into v_order;
  perform public.credit_hold(v_user, 'credit_order', v_order.id, p_estimate, 'Job hold');
  return v_order;
end;
$$;

-- Moves part of a job's hold to the hold of one of its pieces (a generation, a turn's tokens, a Studio order's
-- tokens). The balance does not move: the job's hold shrinks by exactly what the piece now holds.
create or replace function public.credit_order_draw(p_order_id uuid, p_ref_kind text, p_ref_id uuid, p_amount integer, p_reason text, p_job_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_order public.credit_orders;
  v_left integer;
begin
  if p_amount is null or p_amount <= 0 then
    return 0;
  end if;
  select * into v_order from public.credit_orders where id = p_order_id;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  perform public.lock_credit_owner(v_order.user_id);
  select * into v_order from public.credit_orders where id = p_order_id for update;
  if v_order.status <> 'open' then
    raise exception 'This job is closed. Start it again.' using errcode = 'P0001';
  end if;
  v_left := public.credit_held('credit_order', v_order.id);
  if v_left < p_amount then
    raise exception 'This job needs more credits than its estimate. Start it again.' using errcode = 'P0001';
  end if;
  perform public.credit_settle(v_order.user_id, 'credit_order', v_order.id, v_left - p_amount, 'Job hold moved', p_job_id);
  perform public.credit_hold(v_order.user_id, p_ref_kind, p_ref_id, p_amount, p_reason, p_job_id);
  return p_amount;
end;
$$;

-- Closes a job: what it still holds goes back to the balance. Idempotent.
create or replace function public.credit_order_close_for(p_user uuid, p_order_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_order public.credit_orders;
  v_back integer := 0;
begin
  perform public.lock_credit_owner(p_user);
  select * into v_order from public.credit_orders where id = p_order_id and user_id = p_user for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if v_order.status = 'closed' then
    return 0;
  end if;
  v_back := greatest(public.credit_held('credit_order', v_order.id), 0);
  perform public.credit_refund(p_user, 'credit_order', v_order.id, 'Job refund');
  update public.credit_orders set status = 'closed', closed_at = now() where id = v_order.id;
  return v_back;
end;
$$;

create or replace function public.credit_order_close(p_order_id uuid)
returns integer
language sql security definer set search_path = public as $$
  select public.credit_order_close_for(public.require_user(), p_order_id);
$$;

-- Jobs open for more than a day: nothing is still being made for them.
create or replace function public.credit_orders_reap()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select id, user_id from public.credit_orders
    where status = 'open' and created_at < now() - interval '24 hours'
    order by created_at limit 200
  loop
    perform 1 from public.profiles where id = v_order.user_id for update skip locked;
    if not found and exists (select 1 from public.profiles where id = v_order.user_id) then
      continue;
    end if;
    perform public.credit_order_close_for(v_order.user_id, v_order.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

drop function public.create_generation(uuid, uuid, text, jsonb, text, uuid);
create function public.create_generation(p_job_id uuid, p_clip_id uuid, p_model text, p_spec jsonb, p_spec_hash text, p_request_id uuid, p_order_id uuid default null) RETURNS jsonb
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

  insert into public.generations (user_id, job_id, clip_id, kind, model, spec, spec_hash, credits_reserved, after_id)
  values (v_user, p_job_id, p_clip_id, v_model.kind, v_model.id, p_spec, p_spec_hash, v_price, v_parent.id)
  returning * into v_generation;
  insert into public.tasks (user_id, kind, job_id, clip_id, payload, request_id, status)
  values (v_user, 'generate', p_job_id, p_clip_id, jsonb_build_object('generation_id', v_generation.id), p_request_id,
          case when v_parent.id is not null and v_parent.status <> 'done' then 'awaiting_input' else 'queued' end)
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


create or replace function public.agent_reap_turns() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_turn record;
  v_count integer := 0;
begin
  for v_turn in
    select t.id, t.status, t.session_id, s.user_id
    from public.agent_turns t
    join public.agent_sessions s on s.id = t.session_id
    where (t.status in ('running', 'awaiting_browser') and (s.lock_until is null or s.lock_until < now()))
       or (t.status in ('awaiting_approval', 'awaiting_input', 'awaiting_continue') and s.updated_at < now() - interval '24 hours')
    order by t.created_at
    limit 200
  loop
    -- Credit owner, then session, as every turn RPC; a user or session in use right now is left
    -- for the next sweep.
    perform 1 from public.profiles where id = v_turn.user_id for update skip locked;
    if not found and exists (select 1 from public.profiles where id = v_turn.user_id) then
      continue;
    end if;
    perform 1 from public.agent_sessions where id = v_turn.session_id for update skip locked;
    if not found then
      continue;
    end if;
    -- Under the locks, check again (review R6): a turn the founder resumed between the scan and the locks (new hold,
    -- fresh session lock) must not be closed while it streams.
    if not exists (
      select 1 from public.agent_turns t join public.agent_sessions s on s.id = t.session_id
      where t.id = v_turn.id and t.status = v_turn.status
        and ((t.status in ('running', 'awaiting_browser') and (s.lock_until is null or s.lock_until < now()))
          or (t.status in ('awaiting_approval', 'awaiting_input', 'awaiting_continue') and s.updated_at < now() - interval '24 hours'))
    ) then
      continue;
    end if;
    perform public.agent_close_turn(
      v_turn.id,
      case when v_turn.status = 'running' then 'failed' else 'stopped' end,
      case when v_turn.status = 'running' then 'The assistant stopped responding.' else null end
    );
    v_count := v_count + 1;
  end loop;
  -- Jobs left open (a tab closed mid-job, a crash): give back what they still hold.
  perform public.credit_orders_reap();
  return v_count;
end;
$$;


revoke all on function public.credit_order_open(text, integer, text, uuid, uuid) from public, anon;
grant execute on function public.credit_order_open(text, integer, text, uuid, uuid) to authenticated, service_role;
revoke all on function public.credit_order_close(uuid) from public, anon;
grant execute on function public.credit_order_close(uuid) to authenticated, service_role;
revoke all on function public.credit_order_draw(uuid, text, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.credit_order_draw(uuid, text, uuid, integer, text, uuid) to service_role;
revoke all on function public.credit_order_close_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.credit_order_close_for(uuid, uuid) to service_role;
revoke all on function public.credit_orders_reap() from public, anon, authenticated;
grant execute on function public.credit_orders_reap() to service_role;
revoke all on function public.create_generation(uuid, uuid, text, jsonb, text, uuid, uuid) from public, anon;
grant execute on function public.create_generation(uuid, uuid, text, jsonb, text, uuid, uuid) to authenticated, service_role;
