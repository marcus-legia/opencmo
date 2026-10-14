-- Editor stability C1: a request that reaches the Assistant's step limit (`MAX_STEPS` in
-- apps/web/lib/agent/limits.ts) pauses with pause_reason 'steps'. Like 'time', the tab continues
-- on its own, so it takes the short tab lock and agent_resume_turn needs no change.

alter table public.agent_turns drop constraint if exists agent_turns_pause_reason_check;
alter table public.agent_turns add constraint agent_turns_pause_reason_check
  check (pause_reason is null or pause_reason in ('browser', 'approval', 'input', 'time', 'steps', 'budget'));

create or replace function public.agent_pause_turn(p_turn_id uuid, p_reason text default 'browser')
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_turn public.agent_turns;
begin
  v_turn := public.agent_owned_turn(p_turn_id, v_user);
  if p_reason is null or p_reason not in ('browser', 'approval', 'input', 'time', 'steps', 'budget') then
    raise exception 'Invalid pause reason.' using errcode = '22023';
  end if;
  update public.agent_turns
  set status = case p_reason
        when 'approval' then 'awaiting_approval'
        when 'browser' then 'awaiting_browser'
        when 'input' then 'awaiting_input'
        else 'awaiting_continue' end,
      pause_reason = p_reason
  where id = p_turn_id and status = 'running';
  if not found then
    raise exception 'This assistant turn was stopped.' using errcode = 'P0001';
  end if;
  -- Waiting on a person (approve, answer, extend) can take a while; waiting on the tab cannot.
  update public.agent_sessions
  set lock_until = now() + case when p_reason in ('approval', 'input', 'budget') then interval '30 minutes'
                                else interval '6 minutes' end,
      updated_at = now()
  where id = v_turn.session_id;
end;
$$;
