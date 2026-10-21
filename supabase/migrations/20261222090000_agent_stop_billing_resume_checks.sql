-- 20261222090000: Stop bills what was used, a resume answers the pause it was meant for, and every
-- turn RPC takes its locks in one order.
--
-- 1. Stop closes the turn and settles its hold from the usage recorded so far. The model call that
--    Stop cut short (and a tool's model call still finishing) records its usage afterwards, on a
--    closed turn: it was stored and never charged, so a long answer stopped near its end was free.
--    Usage recorded on a closed turn now settles the difference, never past the turn's hold.
-- 2. `agent_resume_turn` resumed whatever pause was newest: a late tool result or Continue from a
--    second tab answered a different pause, which cancelled its approval card (no decision counts
--    as Cancel) or skipped its question. The caller now names the pause: its status, or the tool
--    calls it answers, which must be pending on that turn.
-- 3. `agent_begin_turn` locked the credit owner, then the session; `agent_stop`, `agent_resume_turn`
--    and the reaper locked the session, then the credit owner (inside `agent_close_turn`). Two
--    requests of one user could deadlock. The order is now: credit owner, session, turn.

begin;

-- ------------------------------------------------------------------ 1. usage after Stop

create or replace function public.agent_record_usage_for(
  p_user uuid, p_turn_id uuid, p_model text, p_input integer, p_output integer, p_cache_read integer, p_cache_write integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
    -- Already settled: charge what this usage adds, up to the hold the user approved and never
    -- past the balance (the hold was given back at the close and may be spent since).
    v_credits := least(v_turn.hold_credits, public.agent_credits(v_total));
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

-- ------------------------------------------------------------------ 2 + 3. resume

drop function if exists public.agent_resume_turn(uuid);

create or replace function public.agent_resume_turn(
  p_session_id uuid, p_waiting text default null, p_tool_use_ids text[] default null
) returns public.agent_turns
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_turn public.agent_turns;
begin
  perform public.agent_owned_session(p_session_id, v_user);
  perform public.lock_credit_owner(v_user);
  perform 1 from public.agent_sessions where id = p_session_id for update;
  select * into v_turn from public.agent_turns
  where session_id = p_session_id
    and status in ('awaiting_browser', 'awaiting_approval', 'awaiting_input', 'awaiting_continue')
  order by number desc limit 1
  for update;
  if not found then
    raise exception 'The assistant is not waiting for you.' using errcode = 'P0001';
  end if;
  if p_waiting is not null and v_turn.status <> p_waiting then
    raise exception 'The assistant is not waiting for that any more. Reload the chat.' using errcode = 'P0001';
  end if;
  if p_tool_use_ids is not null and exists (
    select unnest(p_tool_use_ids)
    except
    select tool_use_id from public.agent_tool_calls where turn_id = v_turn.id and status = 'pending'
  ) then
    raise exception 'The assistant is not waiting for that any more. Reload the chat.' using errcode = 'P0001';
  end if;
  -- Out of held credits: only agent_extend_hold lets the turn continue.
  if v_turn.status = 'awaiting_continue' and v_turn.pause_reason = 'budget' then
    raise exception 'Approve more credits to let the assistant continue.' using errcode = 'P0001';
  end if;
  update public.agent_turns set status = 'running', pause_reason = null
  where id = v_turn.id
    and status in ('awaiting_browser', 'awaiting_approval', 'awaiting_input', 'awaiting_continue')
  returning * into v_turn;
  if not found then
    raise exception 'The assistant is not waiting for you.' using errcode = 'P0001';
  end if;
  update public.agent_sessions set lock_until = now() + interval '6 minutes', updated_at = now()
  where id = p_session_id;
  return v_turn;
end;
$$;
revoke execute on function public.agent_resume_turn(uuid, text, text[]) from public, anon;
grant execute on function public.agent_resume_turn(uuid, text, text[]) to authenticated;

-- ------------------------------------------------------------------ 3. lock order

create or replace function public.agent_stop(p_session_id uuid) returns public.agent_turns
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_turn public.agent_turns;
begin
  perform public.agent_owned_session(p_session_id, v_user);
  -- Credit owner, then session, as agent_begin_turn: Stop waits for a resume in flight.
  perform public.lock_credit_owner(v_user);
  perform 1 from public.agent_sessions where id = p_session_id for update;
  select * into v_turn from public.agent_turns
  where session_id = p_session_id
    and status in ('running', 'awaiting_browser', 'awaiting_approval', 'awaiting_input', 'awaiting_continue')
  order by number desc limit 1
  for update;
  if not found then
    return null;
  end if;
  return public.agent_close_turn(v_turn.id, 'stopped', null);
end;
$$;

create or replace function public.agent_extend_hold(p_session_id uuid)
returns public.agent_turns language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_turn public.agent_turns;
  v_more int := public.agent_extend_credits();
begin
  perform public.agent_owned_session(p_session_id, v_user);
  perform public.lock_credit_owner(v_user);
  perform 1 from public.agent_sessions where id = p_session_id for update;
  select * into v_turn from public.agent_turns
  where session_id = p_session_id and status = 'awaiting_continue' and pause_reason = 'budget'
  order by number desc limit 1
  for update;
  if not found then
    raise exception 'The assistant is not waiting for more credits.' using errcode = 'P0001';
  end if;
  if public.credit_balance(v_user) < v_more then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_more, public.credit_balance(v_user) using errcode = 'P0001';
  end if;
  perform public.credit_hold(v_user, 'agent_turn', v_turn.id, v_more, 'Assistant hold');
  update public.agent_turns
  set hold_credits = hold_credits + v_more, status = 'running', pause_reason = null
  where id = v_turn.id returning * into v_turn;
  update public.agent_sessions set lock_until = now() + interval '6 minutes', updated_at = now()
  where id = p_session_id;
  return v_turn;
end;
$$;

create or replace function public.agent_reap_turns() returns integer
  language plpgsql security definer
  set search_path to 'public'
as $$
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
    perform public.agent_close_turn(
      v_turn.id,
      case when v_turn.status = 'running' then 'failed' else 'stopped' end,
      case when v_turn.status = 'running' then 'The assistant stopped responding.' else null end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

commit;
