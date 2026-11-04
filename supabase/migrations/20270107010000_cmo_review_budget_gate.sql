-- cmo-review B3.1 + B3.2: the weekly budget is a hard limit for work the brain starts, and spending too fast pauses
-- the brain.
--
-- Until now the weekly budget was soft: past it, orders were planned with 0 credits, still ran and charged, and
-- `work_order_spend` only noted the overspend after the money had moved (owner D6: hard for paid steps). The gate sits
-- where a paid run is created, before its credits are held: a run the brain starts on its own (source schedule,
-- event or replan) that would take the week past its budget is refused with a reason the order, the cron log and the
-- Brain page show. Work the founder asks for (chat, buttons, MCP) and Studio steps behind a price card the founder
-- approved are their own decision and are not gated here.
--
-- B3.2, the cost ceiling: when the brain's own runs held more than 40 % of the weekly budget (at least 10 credits)
-- within one hour, the founder's brain pauses (`cmo_paused_at`) with a note on the week; the run that crossed the
-- line still goes, every later one waits until the founder resumes.

create or replace function public.cmo_brain_started(p_input jsonb) returns boolean
language sql immutable as $$ select coalesce(p_input->>'source', '') in ('schedule', 'event', 'replan') $$;
revoke all on function public.cmo_brain_started(jsonb) from public, anon, authenticated;

create or replace function public.cmo_runs_budget_gate()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_root public.work_orders;
  v_in_flight integer;
  v_budget integer;
  v_hour integer;
  v_ceiling integer;
begin
  if new.credits <= 0 or new.kind in ('plan_week', 'publish_post') or not public.cmo_brain_started(new.input) then
    return new;
  end if;
  select * into v_root from public.work_orders
  where user_id = new.user_id and parent_id is null and week = date_trunc('week', current_date)::date;
  if not found then
    return new;
  end if;
  -- Runs already holding credits this week count as spent: they settle later.
  select coalesce(sum(credits), 0)::integer into v_in_flight from public.cmo_runs
  where user_id = new.user_id and status in ('queued', 'running') and created_at >= v_root.week::timestamptz;
  if v_root.spent_credits + v_in_flight + new.credits > v_root.budget_credits then
    raise exception 'This week''s credit budget (% credits) is used up. Raise it in Settings, or ask your CMO for this yourself.',
      v_root.budget_credits using errcode = 'P0001';
  end if;

  select weekly_credit_budget into v_budget from public.profiles where id = new.user_id;
  v_ceiling := greatest(10, ceil(coalesce(v_budget, 0) * 0.4)::integer);
  select coalesce(sum(credits), 0)::integer into v_hour from public.cmo_runs
  where user_id = new.user_id and created_at > now() - interval '1 hour' and public.cmo_brain_started(input);
  if v_hour + new.credits > v_ceiling then
    update public.profiles set cmo_paused_at = coalesce(cmo_paused_at, now()) where id = new.user_id;
    perform public.work_order_event(v_root, 'note',
      'Paused: your CMO started ' || (v_hour + new.credits) || ' credits of work within an hour (limit ' || v_ceiling
      || '). Resume it when you are ready.');
  end if;
  return new;
end;
$$;
revoke all on function public.cmo_runs_budget_gate() from public, anon, authenticated;

drop trigger if exists cmo_runs_budget_gate on public.cmo_runs;
create trigger cmo_runs_budget_gate before insert on public.cmo_runs
  for each row execute function public.cmo_runs_budget_gate();
