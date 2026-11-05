-- Charge before running (plan 2026-11-06, phase 1): an Assistant turn is billed for every credit it used.
-- Until now the close charged least(hold, used), so a step that ran past the hold was free.

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

