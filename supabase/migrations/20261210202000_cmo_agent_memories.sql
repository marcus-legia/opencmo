-- 20261210202000: memories the agent saves are marked as the agent's (fix 10, Session C).
--
-- The CMO chat and MCP's `remember` saved every note as `type 'user'`, `importance 3`: the same
-- weight as the founder's own words. A note planted by a website or a Reddit post would then sit
-- at the top of every later plan and draft. Notes now carry where they came from:
-- - `'user'`  (default): the founder's own note, importance 3;
-- - `'agent'`: saved by the chat or MCP tool, importance 2, so it ranks below the founder's notes
--   (`cmoState` and `recall()` order by importance).
-- The chat also refuses memory writes after reading outside content in the same turn
-- (`lib/agent/loop.ts`); MCP cannot see that across stateless calls, so it always saves as 'agent'.

begin;

alter table public.cmo_memories drop constraint cmo_memories_type_check;
alter table public.cmo_memories add constraint cmo_memories_type_check check (type in ('feedback', 'user', 'agent'));

drop function public.cmo_remember(text, text);
create function public.cmo_remember(p_body text, p_topic text default 'general', p_source text default 'user')
returns public.cmo_memories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.cmo_memories;
begin
  if p_body is null or char_length(trim(p_body)) = 0 or char_length(p_body) > 600 then
    raise exception 'Keep the note under 600 characters.' using errcode = '22023';
  end if;
  if p_topic is null or p_topic not in ('general', 'post', 'sales', 'video', 'research') then
    raise exception 'Unknown topic.' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('user', 'agent') then
    raise exception 'Unknown note source.' using errcode = '22023';
  end if;
  -- At the cap, drop the least important, oldest note rather than simply the oldest one.
  if (select count(*) from public.cmo_memories where user_id = v_user) >= 200 then
    delete from public.cmo_memories where id in (
      select id from public.cmo_memories where user_id = v_user order by importance, created_at limit 1
    );
  end if;
  insert into public.cmo_memories (user_id, type, kind, topic, importance, body)
  values (v_user, p_source, case when p_source = 'user' then 'preference' else 'fact' end, p_topic,
    case when p_source = 'user' then 3 else 2 end, trim(p_body))
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.cmo_remember(text, text, text) from public, anon;
grant execute on function public.cmo_remember(text, text, text) to authenticated;

commit;
