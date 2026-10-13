-- Abandoned Assistant turns: a request killed mid-step left its turn 'running', and a tab closed on
-- a card left it waiting. Nothing closed them until the user sent another prompt in that same chat,
-- so the credits held for the turn stayed out of the balance. The worker's one-minute sweep now
-- closes them: running or waiting on the browser once the session lock has lapsed (like
-- agent_begin_turn does), waiting on the user after a day without activity.

create or replace function public.agent_reap_turns() returns integer
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_turn record;
  v_count integer := 0;
begin
  for v_turn in
    select t.id, t.status, t.session_id
    from public.agent_turns t
    join public.agent_sessions s on s.id = t.session_id
    where (t.status in ('running', 'awaiting_browser') and (s.lock_until is null or s.lock_until < now()))
       or (t.status in ('awaiting_approval', 'awaiting_input', 'awaiting_continue') and s.updated_at < now() - interval '24 hours')
    order by t.created_at
    limit 200
  loop
    -- Same lock order as agent_stop and agent_resume_turn (session, then turn); a session in use
    -- right now is left for the next sweep.
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

revoke execute on function public.agent_reap_turns() from public, anon, authenticated;
grant execute on function public.agent_reap_turns() to service_role;
