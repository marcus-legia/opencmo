-- Sales: one card per PERSON, not only per thread (review 2026-11-21, note 09 §2.6).
--
-- `unique (user_id, url)` kept the same thread from coming back, but the same author in a new thread became a new card,
-- and could get a second DM. The opt-out line promises "I will not write again", and the AUP forbids contacting people
-- who asked not to be. So a scan never saves a card for an author (same platform, handle compared case-insensitively)
-- the founder already has any card for: an open one, one they replied to, DM'd or emailed, one marked not
-- interested, or one dismissed as not a fit. The scan skips them before scoring (`seenAuthors` in sales-scan.ts); this
-- holds it when that check is bypassed or two threads of one author arrive in one save.
--
-- An author we cannot tell apart is never deduped: empty, or Reddit's `[deleted]` / `[removed]`.
--
-- Redeclares the function of the current schema (20270131010001); only the `v_person` lines are new.

create index if not exists opportunities_user_person_key_idx
  on public.opportunities (user_id, platform, (lower(btrim(author))));

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
  v_platform text;
  v_person text;
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
    v_platform := coalesce(v_item->>'platform', 'reddit');
    if v_platform not in ('reddit', 'hn', 'facebook', 'threads') then
      raise exception 'A conversation comes from Reddit, Hacker News, a Facebook group or Threads.' using errcode = '22023';
    end if;
    -- One card per person: the key is the stored author (cut to 100 like the column), trimmed and lower-cased.
    v_person := lower(btrim(left(coalesce(v_item->>'author', ''), 100)));
    if v_person not in ('', '[deleted]', '[removed]', 'u/[deleted]', 'u/[removed]') and exists (
      select 1 from public.opportunities o
      where o.user_id = p_user and o.platform = v_platform and lower(btrim(o.author)) = v_person
    ) then
      continue;
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
      p_user, p_run, v_platform, v_item->>'url', left(coalesce(v_item->>'community', ''), 100),
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

-- The authors a scan skips before scoring (`seenAuthors`): the same key as above, one row per person.
create or replace function public.cmo_seen_authors(p_user uuid) returns table (platform text, author text)
  language sql stable security definer
  set search_path to ''
as $$
  select distinct o.platform, lower(btrim(o.author))
  from public.opportunities o
  where o.user_id = p_user
    and lower(btrim(o.author)) not in ('', '[deleted]', '[removed]', 'u/[deleted]', 'u/[removed]')
  limit 5000;
$$;

revoke all on function public.cmo_seen_authors(uuid) from public, anon, authenticated;
grant execute on function public.cmo_seen_authors(uuid) to service_role;
