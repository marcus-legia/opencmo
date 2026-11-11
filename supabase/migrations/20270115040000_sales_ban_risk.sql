-- Groups 4 and 5, item 5.3 (docs/plans/cmo/2026-11-10-groups-4-5-plan.md §4.4): a founder rule that would get a
-- Reddit account banned never reaches Sales. The founder's rules that reach Sales are the voice rules
-- (`cmo_corrections`) and the memories (`cmo_memories`, topics general and sales).
--
-- The patterns are `packages/contracts/sales-ban-risk.json`, copied here as they are (`ban-risk.check.ts` holds the
-- two together); the routes check the same list with zod first, so the founder reads the message before any write.
-- A rule is risky when it matches one pattern AND is about Sales: a sales memory, or a rule that names replies,
-- comments, threads, Reddit or Sales. A rule for the Writer's posts ("add a link to the post") is not touched.
--
-- Triggers, not each RPC: every write path (the Voice page, the card, the rating sheet, the CMO chat's `remember`)
-- goes through them. What the founder writes is refused with the message. What a job writes for them (a proposed
-- rule from their ratings, a dismissal reason kept as feedback) is dropped instead, so the job or the dismissal
-- still finishes.

begin;

create or replace function public.sales_ban_risk(p_text text, p_sales boolean) returns text
language sql immutable
set search_path to 'public'
as $$
  select case
    when p_text is null or not (p_sales or p_text ~* '(reddit|subreddit|hacker news|repl(y|ies)|comments?|threads?|sales)') then null
    when p_text ~* '(add|include|put|drop|share|paste|insert|post)[^.!?]{0,40}(links?|urls?|websites?|https?:)'
      then 'Replies never carry a link: most communities remove them and ban the account. Write the rule without the link.'
    when p_text ~* '((official|company|brand)[^.!?]{0,20}(account|page|team|representative)|on behalf of (the|our|my) (company|team|brand))'
      then 'Replies come from you, a person, never as an official or company account. Write the rule without that.'
    when p_text ~* '((long|longer|detailed|full)[^.!?]{0,30}(pitch|promo|promotion|advert)|always (promote|pitch|sell|advertise)|(promote|pitch|sell|advertise)[^.!?]{0,30}(every|each|all) (repl|comment|thread))'
      then 'Long or constant promotion gets an account banned. Replies help first and name the product at most once.'
    when p_text ~* '(same (reply|comment|message|answer|text)[^.!?]{0,40}(every|each|all|many|multiple|several)|(copy|paste|reuse|repeat)[^.!?]{0,30}(repl|comment|answer)[^.!?]{0,30}(every|each|all|many|multiple|several|across))'
      then 'The same reply in many threads reads as spam and gets the account banned. Each reply is written for its thread.'
  end
$$;
revoke all on function public.sales_ban_risk(text, boolean) from public, anon, authenticated;
grant execute on function public.sales_ban_risk(text, boolean) to service_role;

-- Security definer: the check runs whoever writes, and no role needs to call `sales_ban_risk` itself.
create or replace function public.cmo_memories_ban_risk() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_message text;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body and new.topic is not distinct from old.topic then
    return new;
  end if;
  v_message := public.sales_ban_risk(new.body, new.topic = 'sales');
  if v_message is null or new.topic not in ('general', 'sales') then
    return new;
  end if;
  -- The founder (or their CMO chat, signed in as them) is told why; a note a job writes is dropped.
  if auth.uid() is not null and new.type in ('user', 'agent') then
    raise exception '%', v_message using errcode = '22023';
  end if;
  return case when tg_op = 'INSERT' then null else old end;
end;
$$;

revoke all on function public.cmo_memories_ban_risk() from public, anon, authenticated;

drop trigger if exists cmo_memories_ban_risk on public.cmo_memories;
create trigger cmo_memories_ban_risk before insert or update on public.cmo_memories
  for each row execute function public.cmo_memories_ban_risk();

create or replace function public.cmo_corrections_ban_risk() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_message text;
begin
  if tg_op = 'UPDATE' and new.rule is not distinct from old.rule and new.status is not distinct from old.status then
    return new;
  end if;
  -- A rule turned off is not followed: it may stay as it is.
  if new.status = 'rejected' then
    return new;
  end if;
  v_message := public.sales_ban_risk(new.rule, false);
  if v_message is null then
    return new;
  end if;
  -- A proposal a job made (from edits or ratings) is dropped; the founder's own words or approval is refused.
  if tg_op = 'INSERT' and (auth.uid() is null or new.status = 'proposed') then
    return null;
  end if;
  raise exception '%', v_message using errcode = '22023';
end;
$$;

revoke all on function public.cmo_corrections_ban_risk() from public, anon, authenticated;

drop trigger if exists cmo_corrections_ban_risk on public.cmo_corrections;
create trigger cmo_corrections_ban_risk before insert or update on public.cmo_corrections
  for each row execute function public.cmo_corrections_ban_risk();

commit;
