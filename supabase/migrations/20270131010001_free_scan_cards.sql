-- Free scan A3: a free scan saves its cards without reply drafts (docs/plans/cmo/2026-11-18-free-scan-plan.md).
--
-- An opportunity with `reply = ''` and `rule <> 'skip'` is a card not drafted yet: the free scan found, scored and
-- read the rules for it, and `sales_reply_drafts` writes its reply after the founder pays. No new column; the reply
-- text a free account could read through RLS is simply not there.
--
-- 1. `opportunities.reply` may be empty (it was 1..3000 characters).
-- 2. `cmo_save_opportunities` keeps a card with no reply only for the account's free scan: the run itself says so
--    (a `sales_scan` priced 0), never the items. A paid scan still drops a card whose draft failed its checks.
--    Redeclares the function of the current schema; only the `v_free` lines change.

alter table public.opportunities drop constraint if exists opportunities_reply_check;
alter table public.opportunities add constraint opportunities_reply_check check (char_length(reply) <= 3000);

create or replace function public.cmo_save_opportunities(p_user uuid, p_run uuid, p_items jsonb) returns integer
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_score integer;
  v_gen jsonb;
  v_rule text;
  v_karma integer;
  v_age integer;
  -- The account's free scan (priced 0, 20270131010000) saves its cards without a draft: '' means not drafted yet.
  v_free boolean := exists (
    select 1 from public.cmo_runs r where r.id = p_run and r.user_id = p_user and r.kind = 'sales_scan' and r.credits = 0
  );
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 10 then
    raise exception 'These conversations are not valid.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_score := least(100, greatest(0, coalesce((v_item->>'score')::integer, 0)));
    v_gen := case when jsonb_typeof(v_item->'gen') = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'model', left(v_item->'gen'->>'model', 100),
      'prompt_version', left(v_item->'gen'->>'prompt_version', 40))) else '{}'::jsonb end;
    -- The subreddit's rule the draft was written under (P5 R1, 5.1); a skipped thread is kept without a draft.
    v_rule := case v_item->>'rule'
      when 'mention_ok' then 'safe'
      when 'help_only' then 'no_product_mention'
      else case when v_item->>'rule' in ('safe', 'requires_disclosure', 'no_product_mention', 'not_verified', 'skip') then v_item->>'rule' end
    end;
    if v_rule is distinct from 'skip' and coalesce(v_item->>'reply', '') = '' and not v_free then
      continue;
    end if;
    if coalesce(v_item->>'platform', 'reddit') not in ('reddit', 'hn', 'facebook', 'threads') then
      raise exception 'A conversation comes from Reddit, Hacker News, a Facebook group or Threads.' using errcode = '22023';
    end if;
    -- Clamped while still numeric: a huge number (1e10) cast to integer first would abort the whole scan's save.
    v_karma := case when jsonb_typeof(v_item->'min_karma') = 'number' and (v_item->>'min_karma')::numeric between 0 and 1000000
      then (v_item->>'min_karma')::numeric::integer end;
    v_age := case when jsonb_typeof(v_item->'min_account_age_days') = 'number' and (v_item->>'min_account_age_days')::numeric between 0 and 3650
      then (v_item->>'min_account_age_days')::numeric::integer end;
    insert into public.opportunities (
      user_id, run_id, platform, url, community, title, author, snippet, posted_at, comments, score, score_parts, reply,
      priority, gen, rule, rule_why, min_karma, min_account_age_days
    ) values (
      p_user, p_run, coalesce(v_item->>'platform', 'reddit'), v_item->>'url', left(coalesce(v_item->>'community', ''), 100),
      left(v_item->>'title', 400),
      left(coalesce(v_item->>'author', ''), 100), left(coalesce(v_item->>'snippet', ''), 1200),
      nullif(v_item->>'posted_at', '')::timestamptz, greatest(0, coalesce((v_item->>'comments')::integer, 0)),
      v_score, coalesce(v_item->'score_parts', '[]'::jsonb),
      case when v_rule = 'skip' then null else left(coalesce(v_item->>'reply', ''), 3000) end,
      case when v_score >= 85 then 'high' when v_score >= 70 then 'medium' else 'low' end,
      v_gen, v_rule, left(nullif(trim(coalesce(v_item->>'rule_why', '')), ''), 200),
      case when v_karma between 0 and 1000000 then v_karma end,
      case when v_age between 0 and 3650 then v_age end
    )
    on conflict (user_id, url) do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  update public.content_items set status = 'published', published_at = now(), updated_at = now()
  where user_id = p_user and department = 'sales' and status = 'planned' and day <= current_date;
  return v_count;
end;
$$;

revoke all on function public.cmo_save_opportunities(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cmo_save_opportunities(uuid, uuid, jsonb) to service_role;
