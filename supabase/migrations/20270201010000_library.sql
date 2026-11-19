-- Wave 3 A2 (docs/plans/cmo/2026-11-20-wave3-plan.md §1): the Library, Sales' store. A scan keeps, per conversation,
-- one summary line and a few short quotes, grouped into themes; Post writes from it. Privacy (PR #236): the link,
-- community and date stay on the opportunity; nothing about the author is stored here.
--
-- A post written from the Library keeps its sources in `content_items.body->'sources'`, an array of PostSource
-- (`{"opportunityId", "summary", "platform", "community"}`, apps/web/lib/cmo/jobs/types.ts); `my_library` counts those.

create table public.library_themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index library_themes_user_name_idx on public.library_themes (user_id, lower(name));

create table public.library_entries (
  opportunity_id uuid primary key references public.opportunities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  theme_id uuid references public.library_themes (id) on delete set null,
  summary text not null check (char_length(summary) between 1 and 200),
  quotes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(quotes) = 'array' and jsonb_array_length(quotes) <= 4 and octet_length(quotes::text) <= 2048),
  platform text not null check (platform in ('reddit', 'hn', 'facebook', 'threads')),
  community text not null default '' check (char_length(community) <= 100),
  posted_at timestamptz,
  created_at timestamptz not null default now()
);
create index library_entries_user_theme_idx on public.library_entries (user_id, theme_id, created_at desc);

alter table public.library_themes enable row level security;
alter table public.library_entries enable row level security;
create policy "read own library themes" on public.library_themes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own library entries" on public.library_entries for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.library_themes, public.library_entries to authenticated;
grant select, insert, update, delete on public.library_themes, public.library_entries to service_role;

-- The scan's save. Items: `{"url", "theme", "summary", "quotes": [{"kind": "pain"|"evidence", "text"}]}`, keyed by the
-- conversation's url (the opportunity `cmo_save_opportunities` just wrote, or one an earlier scan kept). A later scan
-- of the same conversation updates its line. A quote that is not one of the two kinds, or empty, is dropped; long
-- text is cut to the limits of `LIBRARY_LIMITS` (apps/web/lib/cmo/library.ts).
create function public.cmo_save_library(p_user uuid, p_run uuid, p_items jsonb)
returns integer
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_item jsonb;
  v_opp public.opportunities;
  v_theme uuid;
  v_name text;
  v_summary text;
  v_quotes jsonb;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.cmo_runs r where r.id = p_run and r.user_id = p_user and r.kind = 'sales_scan'
  ) then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'These Library entries are not valid.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    continue when jsonb_typeof(v_item) <> 'object';
    v_summary := left(btrim(coalesce(v_item->>'summary', '')), 200);
    continue when v_summary = '';
    select * into v_opp from public.opportunities o where o.user_id = p_user and o.url = v_item->>'url';
    continue when not found;

    v_name := left(btrim(regexp_replace(coalesce(v_item->>'theme', ''), '\s+', ' ', 'g')), 80);
    if v_name = '' then
      v_name := 'Other';
    end if;
    insert into public.library_themes (user_id, name) values (p_user, v_name)
    on conflict (user_id, lower(name)) do nothing
    returning id into v_theme;
    if v_theme is null then
      select t.id into v_theme from public.library_themes t where t.user_id = p_user and lower(t.name) = lower(v_name);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('kind', q->>'kind', 'text', left(btrim(q->>'text'), 280))), '[]'::jsonb)
    into v_quotes
    from (
      select q from jsonb_array_elements(case when jsonb_typeof(v_item->'quotes') = 'array' then v_item->'quotes' else '[]'::jsonb end) q
      where jsonb_typeof(q) = 'object' and q->>'kind' in ('pain', 'evidence') and btrim(coalesce(q->>'text', '')) <> ''
      limit 4
    ) s;

    insert into public.library_entries (opportunity_id, user_id, theme_id, summary, quotes, platform, community, posted_at)
    values (v_opp.id, p_user, v_theme, v_summary, v_quotes, v_opp.platform, v_opp.community, v_opp.posted_at)
    on conflict (opportunity_id) do update set
      theme_id = excluded.theme_id, summary = excluded.summary, quotes = excluded.quotes;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.cmo_save_library(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cmo_save_library(uuid, uuid, jsonb) to service_role;

-- The Library page: the founder's themes, most quoted first, each with its count, the count of the last 7 days (the
-- weekly trend), the posts written from it, and its three newest entries. `p_source` keeps one platform.
create function public.my_library(p_source text default null)
returns table (id uuid, name text, count integer, this_week integer, used_in_posts integer, entries jsonb)
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if p_source is not null and p_source not in ('reddit', 'hn', 'facebook', 'threads') then
    raise exception 'Pick Reddit, Hacker News, Facebook groups or Threads.' using errcode = '22023';
  end if;
  return query
  with e as (
    select le.* from public.library_entries le
    where le.user_id = v_user and le.theme_id is not null and (p_source is null or le.platform = p_source)
  )
  select t.id, t.name,
    (select count(*)::integer from e where e.theme_id = t.id),
    (select count(*)::integer from e where e.theme_id = t.id and e.created_at > now() - interval '7 days'),
    (select count(*)::integer from public.content_items ci
      where ci.user_id = v_user and jsonb_typeof(ci.body->'sources') = 'array'
        and exists (
          select 1 from jsonb_array_elements(ci.body->'sources') s
          join e on e.theme_id = t.id and e.opportunity_id::text = s->>'opportunityId'
        )),
    (select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) from (
      select jsonb_build_object(
        'opportunityId', e.opportunity_id, 'platform', e.platform, 'community', e.community,
        'postedAt', e.posted_at, 'summary', e.summary, 'quotes', e.quotes, 'themeId', e.theme_id
      ) j, row_number() over (order by e.posted_at desc nulls last, e.created_at desc) ord
      from e where e.theme_id = t.id
      order by ord limit 3
    ) x)
  from public.library_themes t
  where t.user_id = v_user and exists (select 1 from e where e.theme_id = t.id)
  order by 3 desc, t.name;
end;
$$;

revoke all on function public.my_library(text) from public, anon;
grant execute on function public.my_library(text) to authenticated;

-- A removal request (the post was deleted, or its author asked): drop every Library line kept from that link, for
-- every founder. The opportunity row itself follows the Sales retention rules.
create function public.library_delete_entry(p_url text)
returns integer
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_count integer;
begin
  delete from public.library_entries le
  using public.opportunities o
  where o.id = le.opportunity_id and o.url = btrim(coalesce(p_url, ''));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.library_delete_entry(text) from public, anon, authenticated;
grant execute on function public.library_delete_entry(text) to service_role;

-- The founder's theme names, most used first, so the scan's scoring prompt reuses a name before inventing one.
create function public.cmo_library_theme_names(p_user uuid, p_limit integer default 30)
returns setof text
  language sql stable security definer
  set search_path to ''
as $$
  select t.name from public.library_themes t
  left join public.library_entries e on e.theme_id = t.id
  where t.user_id = p_user
  group by t.id, t.name
  order by count(e.opportunity_id) desc, t.name
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke all on function public.cmo_library_theme_names(uuid, integer) from public, anon, authenticated;
grant execute on function public.cmo_library_theme_names(uuid, integer) to service_role;
