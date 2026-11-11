-- Review of the groups 4-5 merge: `sales_ban_risk` (20270115040000) refused rules a founder must be able to write.
--
-- 1. "threads" put any rule in Sales' scope, and an X thread is the Writer's: "Put the link in the last post of each
--    thread" was refused as if it were a Reddit reply. The scope now names Reddit, HN, replies and comments only.
-- 2. A rule that forbids the risky thing is the safe rule: "Never add links in Reddit replies" or "Do not reply as the
--    official company account" were refused. A negated clause (`negated` in packages/contracts/sales-ban-risk.json)
--    is taken out before the patterns run; "Don't forget to add a link to each reply" is still refused.
--
-- Patterns, scope and messages are `packages/contracts/sales-ban-risk.json` as they are (`ban-risk.check.ts` holds the
-- two together). The triggers call this function, so they need no change.

create or replace function public.sales_ban_risk(p_text text, p_sales boolean) returns text
language sql immutable
set search_path to 'public'
as $$
  select case
    when p_text is null or not (p_sales or p_text ~* '(reddit|subreddit|hacker news|repl(y|ies)|comments?|sales)') then null
    else (select case
      when t ~* '(add|include|put|drop|share|paste|insert|post)[^.!?]{0,40}(links?|urls?|websites?|https?:)'
        then 'Replies never carry a link: most communities remove them and ban the account. Write the rule without the link.'
      when t ~* '((official|company|brand)[^.!?]{0,20}(account|page|team|representative)|on behalf of (the|our|my) (company|team|brand))'
        then 'Replies come from you, a person, never as an official or company account. Write the rule without that.'
      when t ~* '((long|longer|detailed|full)[^.!?]{0,30}(pitch|promo|promotion|advert)|always (promote|pitch|sell|advertise)|(promote|pitch|sell|advertise)[^.!?]{0,30}(every|each|all) (repl|comment|thread))'
        then 'Long or constant promotion gets an account banned. Replies help first and name the product at most once.'
      when t ~* '(same (reply|comment|message|answer|text)[^.!?]{0,40}(every|each|all|many|multiple|several)|(copy|paste|reuse|repeat)[^.!?]{0,30}(repl|comment|answer)[^.!?]{0,30}(every|each|all|many|multiple|several|across))'
        then 'The same reply in many threads reads as spam and gets the account banned. Each reply is written for its thread.'
      end
      from (select regexp_replace(p_text, '(never|n[''’]t|not|avoid|stop|no)\s+(add|include|put|drop|share|paste|insert|post|reply|answer|write|use|promote|pitch|sell|advertise|copy|reuse|repeat|comment)[^.!?,;]*', '', 'gi') as t) asked)
  end
$$;
revoke all on function public.sales_ban_risk(text, boolean) from public, anon, authenticated;
grant execute on function public.sales_ban_risk(text, boolean) to service_role;
