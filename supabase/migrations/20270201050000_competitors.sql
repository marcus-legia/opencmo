-- Wave 3 A6 (docs/plans/cmo/2026-11-20-wave3-plan.md §8): Research shows the founder's competitors (logo from their
-- site, price, what they sell, mentions from Sales scans). The founder adds one by pasting a website, or from
-- Research's chat; a route reads the site with the existing site reader and passes what it read here. No automatic
-- competitor search (owner, 2026-11-18).

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The site's host, lowercase, without `www.`: one competitor per site.
  site text not null check (site ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(site) <= 253),
  name text not null check (char_length(name) between 1 and 80),
  logo_url text check (char_length(logo_url) <= 500 and logo_url ~ '^https://'),
  price text check (char_length(price) <= 200),
  offer text check (char_length(offer) <= 300),
  added_via text not null default 'url' check (added_via in ('url', 'chat')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, site)
);

alter table public.competitors enable row level security;
create policy "read own competitors" on public.competitors for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.competitors to authenticated;
grant select, insert, update, delete on public.competitors to service_role;

-- Adds a competitor, or refreshes the one on that site. `p_url` is the site the founder pasted (or the chat found);
-- the rest is what the site reader read, any of it may be empty. At most 20 competitors per founder.
create function public.competitor_add(
  p_url text, p_name text default null, p_logo_url text default null, p_price text default null,
  p_offer text default null, p_via text default 'url'
)
returns public.competitors
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_url text := lower(btrim(coalesce(p_url, '')));
  v_site text;
  v_name text;
  v_row public.competitors;
begin
  if v_url !~ '^https?://' then
    v_url := 'https://' || v_url;
  end if;
  v_site := regexp_replace(split_part(split_part(split_part(regexp_replace(v_url, '^https?://', ''), '/', 1), '?', 1), '#', 1), '^www\.', '');
  v_site := split_part(v_site, ':', 1);
  if char_length(v_url) > 500 or v_site !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     or char_length(v_site) > 253 or v_site ~ '^[0-9.]+$' or v_site ~ '(^|\.)(localhost|local|internal)$' then
    raise exception 'Paste the competitor''s website, like example.com.' using errcode = '22023';
  end if;
  if coalesce(p_via, 'url') not in ('url', 'chat') then
    raise exception 'Unknown source.' using errcode = '22023';
  end if;
  if (select count(*) from public.competitors c where c.user_id = v_user and c.site <> v_site) >= 20 then
    raise exception 'Keep at most 20 competitors.' using errcode = 'P0001';
  end if;
  v_name := left(nullif(btrim(coalesce(p_name, '')), ''), 80);
  insert into public.competitors (user_id, site, name, logo_url, price, offer, added_via)
  values (v_user, v_site, coalesce(v_name, v_site),
    case when btrim(coalesce(p_logo_url, '')) ~ '^https://' and char_length(btrim(p_logo_url)) <= 500 then btrim(p_logo_url) end,
    left(nullif(btrim(coalesce(p_price, '')), ''), 200), left(nullif(btrim(coalesce(p_offer, '')), ''), 300),
    coalesce(p_via, 'url'))
  on conflict (user_id, site) do update set
    name = coalesce(v_name, public.competitors.name),
    logo_url = coalesce(excluded.logo_url, public.competitors.logo_url),
    price = coalesce(excluded.price, public.competitors.price),
    offer = coalesce(excluded.offer, public.competitors.offer),
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.competitor_add(text, text, text, text, text, text) from public, anon;
grant execute on function public.competitor_add(text, text, text, text, text, text) to authenticated;

create function public.competitor_remove(p_id uuid)
returns boolean
  language plpgsql security definer
  set search_path to ''
as $$
begin
  delete from public.competitors c where c.id = p_id and c.user_id = public.require_user();
  return found;
end;
$$;
revoke all on function public.competitor_remove(uuid) from public, anon;
grant execute on function public.competitor_remove(uuid) to authenticated;

-- How often people in the founder's Sales conversations name each competitor, per week (Monday, UTC): the
-- competitor's name as a whole word in the thread's title or text. Names under three letters are not counted.
create view public.my_competitor_mentions with (security_invoker = true) as
  select c.id as competitor_id, c.name, date_trunc('week', o.created_at)::date as week, count(*)::integer as mentions
  from public.competitors c
  join public.opportunities o on o.user_id = c.user_id
    and (o.title || ' ' || o.snippet) ~* ('\m' || regexp_replace(c.name, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M')
  where c.user_id = (select auth.uid()) and char_length(c.name) >= 3
  group by c.id, c.name, date_trunc('week', o.created_at);
grant select on public.my_competitor_mentions to authenticated;
