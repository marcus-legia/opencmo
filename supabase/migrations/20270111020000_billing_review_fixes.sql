-- Billing fixes from the 2026-11-06 review (cmo-review-2 S3.7).
--
-- 1. agent_close_turn: when a turn used more than it held, the settle row charges the balance, yet it was labelled
--    "Assistant refund". It is now "Assistant usage"; a turn that used less than its hold still says "Assistant refund".
--    The body is 20270110010000's, with only the label changed.
-- 2. studio_order_release_hold: a Studio order's usage covered by its hold never reached work_order_spend (only usage
--    past the hold did, in studio_record_usage), so the week's budget did not count it. When the order ends, the part
--    the hold covered is added to the order's spend (and its parents', as work_order_spend does).
--
-- Not here: credit_order_draw still writes two ledger rows per draw (the job's hold returned, the piece's hold taken).
-- A ledger row carries one (ref_kind, ref_id) and credit_held sums by it, so one row cannot move credits between two
-- holds without changing the money primitives; the plan says to ask the owner first (S3 notes).

begin;

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

  -- The unused part of the hold comes back; usage past it is charged from the balance. The ledger row says which, so
  -- a charge is not listed as a refund on the Credits page.
  perform public.credit_settle(v_user, 'agent_turn', v_turn.id, v_credits,
    case when v_credits > public.credit_held('agent_turn', v_turn.id) then 'Assistant usage' else 'Assistant refund' end);

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

create or replace function public.studio_order_release_hold() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_held integer;
  v_used integer;
  v_hold integer;
  v_covered integer;
begin
  if new.status not in ('done', 'failed', 'cancelled') or old.status in ('done', 'failed', 'cancelled') then
    return new;
  end if;
  perform public.lock_credit_owner(new.user_id);
  v_held := public.credit_held('work_order', new.id);
  if v_held <= 0 then
    return new;
  end if;
  v_used := public.agent_credits((select coalesce(sum(micro_usd), 0)::bigint from public.work_order_usage where order_id = new.id));
  -- The allowance studio_order_hold took. Usage past it was charged and counted by studio_record_usage already.
  v_hold := (select coalesce(-sum(delta), 0)::integer from public.credit_ledger
             where ref_kind = 'work_order' and ref_id = new.id and reason = 'CMO video team hold');
  v_covered := least(v_used, greatest(v_hold, 0));
  if v_used < v_held then
    perform public.credit_settle(new.user_id, 'work_order', new.id, v_used, 'CMO video team hold returned');
  end if;
  -- An AFTER trigger: work_order_spend's update of this row sees it already ended, so it does not come back here.
  perform public.work_order_spend(new.id, v_covered);
  return new;
end;
$$;
revoke all on function public.studio_order_release_hold() from public, anon, authenticated;

commit;
