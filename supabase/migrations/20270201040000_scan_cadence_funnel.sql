-- Wave 3 A5 (docs/plans/cmo/2026-11-20-wave3-plan.md §4, §7): Sales scans on their own cadence (Settings › Sales
-- scans: Mon/Wed/Fri by default, weekdays, or Mondays), and the funnel counts itself from the people's statuses.

alter table public.sales_settings
  add column cadence text not null default 'mwf' check (cadence in ('mwf', 'weekdays', 'monday'));

-- One more argument; the three-argument form goes so a call by name finds exactly one function.
drop function public.sales_settings_save(text[], jsonb, text[]);

create function public.sales_settings_save(p_excluded text[], p_pairs jsonb, p_platforms text[] default null, p_cadence text default null)
returns public.sales_settings
  language plpgsql security definer
  set search_path to ''
as $_$
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
  -- Null keeps the saved cadence, as with the platforms.
  if p_cadence is not null and p_cadence not in ('mwf', 'weekdays', 'monday') then
    raise exception 'Scan on Monday, Wednesday and Friday, on weekdays, or on Mondays.' using errcode = '22023';
  end if;
  insert into public.sales_settings (user_id, excluded_subreddits, co_occurrence, platforms, cadence, updated_at)
  values (v_user, v_excluded, v_pairs, coalesce(v_platforms, v_all), coalesce(p_cadence, 'mwf'), now())
  on conflict (user_id) do update
    set excluded_subreddits = excluded.excluded_subreddits, co_occurrence = excluded.co_occurrence,
        platforms = coalesce(v_platforms, public.sales_settings.platforms),
        cadence = coalesce(p_cadence, public.sales_settings.cadence), updated_at = now()
  returning * into v_row;
  return v_row;
end;
$_$;
revoke all on function public.sales_settings_save(text[], jsonb, text[], text) from public, anon;
grant execute on function public.sales_settings_save(text[], jsonb, text[], text) to authenticated;

-- The funnel of the last `p_days` days, per source and for all ('all' first): people found (saved by a scan), replied
-- (the founder's reply, `replied_at`), answered back (answered back, talking, signed up or customer) and signed up
-- (signed up or customer), each counted by when it happened (`status_at` for the later steps). A person marked not
-- interested is counted only as found and replied.
create function public.my_funnel(p_days integer default 7)
returns table (source text, found integer, replied integer, answered_back integer, signed_up integer)
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_since timestamptz;
begin
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'Pick 1 to 90 days.' using errcode = '22023';
  end if;
  v_since := now() - make_interval(days => p_days);
  return query
  with o as (
    select x.platform, x.created_at, x.replied_at, x.status_at, x.person_status
    from public.opportunities x where x.user_id = v_user
      and (x.created_at > v_since or x.replied_at > v_since or x.status_at > v_since)
  ), counted as (
    select o.platform,
      count(*) filter (where o.created_at > v_since)::integer f,
      count(*) filter (where o.replied_at > v_since)::integer r,
      count(*) filter (where o.status_at > v_since and o.person_status in ('answered_back', 'talking', 'signed_up', 'customer'))::integer a,
      count(*) filter (where o.status_at > v_since and o.person_status in ('signed_up', 'customer'))::integer s
    from o group by rollup (o.platform)
  )
  select coalesce(c.platform, 'all'), coalesce(c.f, 0), coalesce(c.r, 0), coalesce(c.a, 0), coalesce(c.s, 0)
  from (select * from counted union all
        select null, 0, 0, 0, 0 where not exists (select 1 from counted)) c
  order by c.platform is not null, array_position(array['reddit', 'hn', 'facebook', 'threads'], c.platform);
end;
$$;
revoke all on function public.my_funnel(integer) from public, anon;
grant execute on function public.my_funnel(integer) to authenticated;
