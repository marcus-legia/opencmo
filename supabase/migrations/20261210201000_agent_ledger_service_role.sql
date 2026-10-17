-- 20261210201000: the Assistant's bookkeeping RPCs leave the browser surface (fix 9, Session C).
--
-- Usage, messages, tool calls and the turn's settlement were callable with the user's own JWT
-- (and with any OAuth client's token). Two holes followed (audit B §5, PR #71 recs 6/8):
-- - early finish: `agent_finish_turn(turn, 'done')` settles the hold, then the server's
--   `agent_record_usage` for the model call still running is recorded but never charged;
-- - no size cap: `agent_record_tool` accepted an 8 MB `p_input`, a cheap way to bloat the database.
--
-- Only server code ever called them (`lib/agent/loop.ts`, `scope.ts`), so they move to
-- service-role variants that take the user id the route already verified. `agent_begin_turn` and
-- `agent_stop` stay user-callable: a user may start and stop their own turn.

begin;

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
begin
  perform public.agent_owned_turn(p_turn_id, p_user);
  if least(p_input, p_output, p_cache_read, p_cache_write) < 0 then
    raise exception 'Invalid usage.' using errcode = '22023';
  end if;
  insert into public.agent_usage(turn_id, model, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, micro_usd)
  values (p_turn_id, left(coalesce(p_model, 'unknown'), 64), p_input, p_output, p_cache_read, p_cache_write,
    public.agent_micro_usd(p_model, p_input, p_output, p_cache_read, p_cache_write));
  select coalesce(sum(micro_usd), 0)::bigint into v_total from public.agent_usage where turn_id = p_turn_id;
  return public.agent_credits(v_total);
end;
$$;

create or replace function public.agent_append_for(p_user uuid, p_turn_id uuid, p_role text, p_content jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turn public.agent_turns;
  v_seq int;
begin
  v_turn := public.agent_owned_turn(p_turn_id, p_user);
  if p_role is null or p_role not in ('user', 'assistant') then
    raise exception 'Invalid assistant message.' using errcode = '22023';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'array' or pg_column_size(p_content) > 1048576 then
    raise exception 'Invalid assistant message.' using errcode = '22023';
  end if;
  perform 1 from public.agent_sessions where id = v_turn.session_id for update;
  select status into v_turn.status from public.agent_turns where id = p_turn_id;
  if v_turn.status <> 'running' then
    raise exception 'This assistant turn was stopped.' using errcode = 'P0001';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from public.agent_messages where session_id = v_turn.session_id;
  insert into public.agent_messages(session_id, turn_id, seq, role, content)
  values (v_turn.session_id, p_turn_id, v_seq, p_role, p_content);
  update public.agent_sessions set lock_until = now() + interval '6 minutes', updated_at = now()
  where id = v_turn.session_id;
  return v_seq;
end;
$$;

create or replace function public.agent_record_tool_for(
  p_user uuid, p_turn_id uuid, p_tool_use_id text, p_name text, p_input jsonb, p_status text, p_result jsonb,
  p_content jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.agent_owned_turn(p_turn_id, p_user);
  if p_status not in ('pending', 'done', 'failed') then
    raise exception 'Invalid tool status.' using errcode = '22023';
  end if;
  -- 256 KB each: far above any real tool call, far below what bloats the table.
  if pg_column_size(p_input) > 262144 or pg_column_size(p_result) > 262144 or pg_column_size(p_content) > 262144 then
    raise exception 'This tool call is too large to save.' using errcode = '22023';
  end if;
  insert into public.agent_tool_calls(turn_id, tool_use_id, name, input, status, result, content)
  values (p_turn_id, p_tool_use_id, p_name, coalesce(p_input, '{}'::jsonb), p_status, p_result, p_content);
end;
$$;

create or replace function public.agent_finish_turn_for(p_user uuid, p_turn_id uuid, p_status text, p_error text)
returns public.agent_turns
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.agent_owned_turn(p_turn_id, p_user);
  if p_status not in ('done', 'failed', 'stopped') then
    raise exception 'Invalid turn status.' using errcode = '22023';
  end if;
  return public.agent_close_turn(p_turn_id, p_status, p_error);
end;
$$;

-- Stays user-callable (the loop answers browser tools with it), but with the same cap: it writes
-- `p_result` into a pending tool call, the other way to bloat `agent_tool_calls`.
create or replace function public.agent_complete_tool(p_turn_id uuid, p_tool_use_id text, p_status text, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  perform public.agent_owned_turn(p_turn_id, v_user);
  if p_status not in ('done', 'failed') then
    raise exception 'Invalid tool status.' using errcode = '22023';
  end if;
  if pg_column_size(p_result) > 262144 then
    raise exception 'This tool call is too large to save.' using errcode = '22023';
  end if;
  update public.agent_tool_calls set status = p_status, result = p_result
  where turn_id = p_turn_id and tool_use_id = p_tool_use_id and status = 'pending';
  if not found then
    raise exception 'That tool call is not waiting for a result.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.agent_record_usage_for(uuid, uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.agent_append_for(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.agent_record_tool_for(uuid, uuid, text, text, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.agent_finish_turn_for(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.agent_record_usage_for(uuid, uuid, text, integer, integer, integer, integer) to service_role;
grant execute on function public.agent_append_for(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.agent_record_tool_for(uuid, uuid, text, text, jsonb, text, jsonb, jsonb) to service_role;
grant execute on function public.agent_finish_turn_for(uuid, uuid, text, text) to service_role;

revoke execute on function public.agent_record_usage(uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.agent_append(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.agent_record_tool(uuid, text, text, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.agent_finish_turn(uuid, text, text) from public, anon, authenticated;

commit;
