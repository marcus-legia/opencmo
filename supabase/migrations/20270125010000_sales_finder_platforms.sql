-- Sales finder A2 (docs/plans/cmo/2026-11-14-sales-finder-plan.md): Sales finds conversations in public Facebook groups
-- and on Threads as well as Reddit and Hacker News, and the founder says where it may look.
--
-- 1. `opportunities.platform` and `cmo_save_opportunities` accept `facebook` and `threads`. X waits for its own plan
--    (its search is the paid official API).
-- 2. `sales_settings.platforms`: at least one place, from the fixed list; every place is on by default.
-- 3. `sales_settings_save` takes the platforms as an optional third argument. The two-argument function is dropped,
--    because both existing would make every two-argument call ambiguous; callers that pass two still resolve here.

-- 1 -----------------------------------------------------------------------------------------------------------------

alter table public.opportunities drop constraint opportunities_platform_check;
alter table public.opportunities add constraint opportunities_platform_check
  check (platform = any (array['reddit', 'hn', 'facebook', 'threads']));
-- Only a post's own page is stored (the one URL `normalizeConversationUrl` keeps): never a group's home, a profile, or a
-- page on another host passed off as one.
alter table public.opportunities drop constraint opportunities_url_check;
alter table public.opportunities add constraint opportunities_url_check check (char_length(url) <= 500 and (
  (platform = 'reddit' and url ~ '^https://(www\.|old\.)?reddit\.com/')
  or (platform = 'hn' and url ~ '^https://news\.ycombinator\.com/item\?id=[0-9]{1,12}$')
  or (platform = 'facebook' and url ~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]{1,100}/(posts|permalink)/[0-9]{1,30}/?$')
  or (platform = 'threads' and url ~ '^https://www\.threads\.com/@[A-Za-z0-9._]{1,30}/post/[A-Za-z0-9_-]{1,40}$')));

create or replace function public.cmo_save_opportunities(p_user uuid, p_run uuid, p_items jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_score integer;
  v_gen jsonb;
  v_rule text;
  v_karma integer;
  v_age integer;
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
    if v_rule is distinct from 'skip' and coalesce(v_item->>'reply', '') = '' then
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
      case when v_rule = 'skip' then null else left(v_item->>'reply', 3000) end,
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


-- 2 -----------------------------------------------------------------------------------------------------------------

alter table public.sales_settings add column platforms text[] not null default '{reddit,hn,facebook,threads}';
alter table public.sales_settings add constraint sales_settings_platforms_check
  check (cardinality(platforms) between 1 and 4 and platforms <@ array['reddit', 'hn', 'facebook', 'threads']);

-- 3 -----------------------------------------------------------------------------------------------------------------

drop function public.sales_settings_save(text[], jsonb);

create function public.sales_settings_save(p_excluded text[], p_pairs jsonb, p_platforms text[] default null) RETURNS public.sales_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := public.require_user();
  v_excluded text[];
  v_pairs jsonb;
  v_all constant text[] := array['reddit', 'hn', 'facebook', 'threads'];
  v_platforms text[];
  v_row public.sales_settings;
begin
  select coalesce(array_agg(distinct n order by n), '{}') into v_excluded
  from (select regexp_replace(lower(btrim(e)), '^/?r/', '') as n from unnest(coalesce(p_excluded, '{}')) e) s
  where n <> '';
  if cardinality(v_excluded) > 50 then
    raise exception 'Exclude at most 50 subreddits.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_excluded) n where n !~ '^[a-z0-9_]{2,21}$') then
    raise exception 'A subreddit name has 2 to 21 letters, digits or underscores.' using errcode = '22023';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'Term pairs must be a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_pairs) > 20 then
    raise exception 'Add at most 20 term pairs.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_pairs) p
             where jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
               or jsonb_typeof(p->0) <> 'string' or jsonb_typeof(p->1) <> 'string') then
    raise exception 'Each pair has exactly two terms.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(a, b)), '[]'::jsonb) into v_pairs
  from (select lower(btrim(p->>0)) as a, lower(btrim(p->>1)) as b from jsonb_array_elements(p_pairs) p) s;
  if exists (select 1 from jsonb_array_elements(v_pairs) p
             where char_length(p->>0) not between 1 and 60 or char_length(p->>1) not between 1 and 60 or p->>0 = p->>1) then
    raise exception 'Each term has 1 to 60 characters, and the two terms of a pair differ.' using errcode = '22023';
  end if;
  -- Null keeps what is saved (an old client, or a form that does not show the switches). The list order is the app's
  -- (`SALES_PLATFORMS`), so the screen and the scan read the same order back.
  if p_platforms is not null then
    select coalesce(array_agg(p order by array_position(v_all, p)), '{}') into v_platforms
    from (select distinct lower(btrim(e)) as p from unnest(p_platforms) e) s;
    if cardinality(v_platforms) = 0 then
      raise exception 'Keep at least one place for Sales to look.' using errcode = '22023';
    end if;
    if not v_platforms <@ v_all then
      raise exception 'Sales can look on Reddit, Hacker News, Facebook groups and Threads.' using errcode = '22023';
    end if;
  end if;
  insert into public.sales_settings (user_id, excluded_subreddits, co_occurrence, platforms, updated_at)
  values (v_user, v_excluded, v_pairs, coalesce(v_platforms, v_all), now())
  on conflict (user_id) do update
    set excluded_subreddits = excluded.excluded_subreddits, co_occurrence = excluded.co_occurrence,
        platforms = coalesce(v_platforms, public.sales_settings.platforms), updated_at = now()
  returning * into v_row;
  return v_row;
end;
$_$;


revoke all on function public.sales_settings_save(text[], jsonb, text[]) from public, anon;
grant execute on function public.sales_settings_save(text[], jsonb, text[]) to authenticated;
