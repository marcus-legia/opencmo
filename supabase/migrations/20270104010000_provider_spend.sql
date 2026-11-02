-- 20270104010000: provider spend ledger (docs/plans/cmo/2026-11-02-provider-spend-ledger-plan.md).
--
-- What every paid provider call costs OpenCMO, in micro-USD, per founder:
-- * provider_usage: one row per paid call (CMO job model calls, ScrapeCreators lookups, fal and ElevenLabs media).
--   The price is computed and stored when the row is written; a later price change never rewrites history.
-- * Model calls are priced by agent_micro_usd (agent_model_prices), the same table the Assistant is charged from, so
--   there is one price list for models. provider_prices holds the other units (a ScrapeCreators call, a second of
--   fal video, 1,000 ElevenLabs characters); a call with no price row is stored with priced = false, never guessed.
-- * A daily safety cap per founder (provider_spend_cap, $5 by default, owner 2026-11-02): read paths ask
--   provider_spend_allowed before they spend.
-- * provider_spend_report: the owner's costs page, for the emails in app_owners only (no service role in the web).
--
-- Nothing here is readable by founders: RLS on, no grants to anon or authenticated on the tables.

begin;

create table public.provider_prices (
  provider   text not null check (provider in ('scrapecreators', 'fal', 'elevenlabs')),
  unit       text not null check (unit ~ '^[a-z0-9_:.-]{1,80}$'),
  micro_usd  numeric not null check (micro_usd >= 0),
  valid_from timestamptz not null default now(),
  note       text check (note is null or char_length(note) <= 300),
  primary key (provider, unit, valid_from)
);
alter table public.provider_prices enable row level security;
revoke all on public.provider_prices from anon, authenticated;
grant all on public.provider_prices to service_role;

-- PROVISIONAL (owner gate 2): ScrapeCreators bills one credit per call; confirm the dollar figure against COSTS.md.
-- fal and ElevenLabs units are recorded unpriced until their rows are added.
insert into public.provider_prices (provider, unit, micro_usd, valid_from, note) values
  ('scrapecreators', 'call', 2000, '2026-01-01', 'PROVISIONAL: $0.002 a call; confirm against COSTS.md');

create table public.provider_usage (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  provider          text not null check (provider in ('anthropic', 'gemini', 'groq', 'openai_compat', 'scrapecreators', 'fal', 'elevenlabs')),
  model_or_endpoint text not null check (char_length(model_or_endpoint) between 1 and 120),
  units             jsonb not null default '{}'::jsonb check (jsonb_typeof(units) = 'object' and octet_length(units::text) <= 1024),
  micro_usd         bigint not null default 0 check (micro_usd >= 0),
  priced            boolean not null default true,
  ref_kind          text check (ref_kind in ('cmo_run', 'agent_turn', 'generation', 'task', 'work_order', 'mcp')),
  ref_id            uuid,
  created_at        timestamptz not null default now()
);
create index provider_usage_user_day_idx on public.provider_usage (user_id, created_at desc);
create index provider_usage_created_idx on public.provider_usage (created_at desc);
alter table public.provider_usage enable row level security;
revoke all on public.provider_usage from anon, authenticated;
grant all on public.provider_usage to service_role;

-- One row. The cap applies to every founder; a paid-plan cap is an owner decision for later.
create table public.provider_spend_cap (
  id        boolean primary key default true check (id),
  micro_usd bigint not null check (micro_usd > 0)
);
alter table public.provider_spend_cap enable row level security;
revoke all on public.provider_spend_cap from anon, authenticated;
grant all on public.provider_spend_cap to service_role;
insert into public.provider_spend_cap (micro_usd) values (5000000);

-- Who may read the costs page. Written by the owner with SQL; no route writes it.
create table public.app_owners (
  email text primary key check (email = lower(email) and char_length(email) between 3 and 320)
);
alter table public.app_owners enable row level security;
revoke all on public.app_owners from anon, authenticated;
grant all on public.app_owners to service_role;

create or replace function public.provider_price(p_provider text, p_unit text) returns numeric
language sql stable security definer set search_path = public
as $$
  select micro_usd from public.provider_prices
  where provider = p_provider and unit = p_unit and valid_from <= now()
  order by valid_from desc limit 1
$$;
revoke all on function public.provider_price(text, text) from public, anon, authenticated;

/**
 * Records one paid call. Model providers pass token counts in p_units (input, output, cache_read, cache_write) and are
 * priced by agent_micro_usd; the others pass counts per unit (e.g. {"call": 1} or {"second": 5}) priced from
 * provider_prices. A unit with no price row leaves the row unpriced, never priced at a guess.
 */
create or replace function public.provider_usage_record(
  p_user uuid, p_provider text, p_model text, p_units jsonb, p_ref_kind text default null, p_ref_id uuid default null
) returns bigint
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_units jsonb := coalesce(p_units, '{}'::jsonb);
  v_micro numeric := 0;
  v_priced boolean := true;
  v_key text;
  v_count numeric;
  v_price numeric;
begin
  if jsonb_typeof(v_units) <> 'object' then
    raise exception 'Usage units must be an object.' using errcode = '22023';
  end if;
  if p_provider in ('anthropic', 'gemini', 'groq', 'openai_compat') then
    v_micro := public.agent_micro_usd(
      p_model,
      greatest(coalesce((v_units->>'input')::bigint, 0), 0),
      greatest(coalesce((v_units->>'output')::bigint, 0), 0),
      greatest(coalesce((v_units->>'cache_read')::bigint, 0), 0),
      greatest(coalesce((v_units->>'cache_write')::bigint, 0), 0));
  else
    for v_key, v_count in select key, (value #>> '{}')::numeric from jsonb_each(v_units) loop
      v_price := public.provider_price(p_provider, v_key);
      if v_price is null then
        v_priced := false;
      else
        v_micro := v_micro + greatest(v_count, 0) * v_price;
      end if;
    end loop;
  end if;
  insert into public.provider_usage (user_id, provider, model_or_endpoint, units, micro_usd, priced, ref_kind, ref_id)
  values (p_user, p_provider, left(coalesce(nullif(btrim(p_model), ''), 'unknown'), 120), v_units, ceil(v_micro)::bigint, v_priced, p_ref_kind, p_ref_id);
  return ceil(v_micro)::bigint;
end;
$$;
revoke all on function public.provider_usage_record(uuid, text, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.provider_usage_record(uuid, text, text, jsonb, text, uuid) to service_role;

/**
 * The founder's own ScrapeCreators lookup from the chat (their JWT). The price is computed here; the caller passes only
 * the endpoint and whether a lookup was billed, so a founder can only ever add to their own spend.
 */
create or replace function public.provider_usage_record_mine(p_endpoint text, p_calls integer, p_ref_kind text default null)
returns bigint
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  if p_calls is null or p_calls not in (0, 1) then
    raise exception 'One lookup at a time.' using errcode = '22023';
  end if;
  if p_endpoint is null or p_endpoint !~ '^/[a-z0-9/_-]{1,100}$' then
    raise exception 'Unknown endpoint.' using errcode = '22023';
  end if;
  if p_ref_kind is not null and p_ref_kind not in ('agent_turn', 'mcp') then
    raise exception 'Unknown reference.' using errcode = '22023';
  end if;
  return public.provider_usage_record(v_user, 'scrapecreators', p_endpoint, jsonb_build_object('call', p_calls), p_ref_kind, null);
end;
$$;
revoke all on function public.provider_usage_record_mine(text, integer, text) from public, anon;
grant execute on function public.provider_usage_record_mine(text, integer, text) to authenticated;

-- Today in UTC, the same day boundary as the other daily limits.
create or replace function public.provider_spend_today(p_user uuid) returns bigint
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(micro_usd), 0)::bigint from public.provider_usage
  where user_id = p_user and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
$$;
revoke all on function public.provider_spend_today(uuid) from public, anon, authenticated;
grant execute on function public.provider_spend_today(uuid) to service_role;

create or replace function public.provider_spend_allowed_for(p_user uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select public.provider_spend_today(p_user) < (select micro_usd from public.provider_spend_cap) $$;
revoke all on function public.provider_spend_allowed_for(uuid) from public, anon, authenticated;
grant execute on function public.provider_spend_allowed_for(uuid) to service_role;

create or replace function public.provider_spend_allowed() returns boolean
language sql stable security definer set search_path = public
as $$ select public.provider_spend_allowed_for(public.require_user()) $$;
revoke all on function public.provider_spend_allowed() from public, anon;
grant execute on function public.provider_spend_allowed() to authenticated;

/**
 * The owner's costs page: the last p_days days by provider and by kind of work, the top 20 founders, and the cost per
 * approved card. Assistant turns come from agent_usage, which already stores their micro-USD. Only for app_owners.
 */
create or replace function public.provider_spend_report(p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_since timestamptz;
  v_result jsonb;
begin
  if not exists (select 1 from public.app_owners where email = v_email) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Pick 1 to 90 days.' using errcode = '22023';
  end if;
  v_since := date_trunc('day', now() at time zone 'utc') at time zone 'utc' - make_interval(days => p_days - 1);
  with spend as (
    select user_id, provider, coalesce(ref_kind, 'other') as kind, micro_usd, priced, created_at from public.provider_usage where created_at >= v_since
    union all
    select s.user_id, 'assistant', 'agent_turn', u.micro_usd, true, u.created_at
    from public.agent_usage u join public.agent_turns t on t.id = u.turn_id join public.agent_sessions s on s.id = t.session_id
    where u.created_at >= v_since
  ),
  approved as (
    select count(*) as n from public.approvals where status in ('approved', 'edited') and decided_at >= v_since
  )
  select jsonb_build_object(
    'since', v_since,
    'total_micro_usd', (select coalesce(sum(micro_usd), 0) from spend),
    'unpriced_calls', (select count(*) from spend where not priced),
    'by_day', coalesce((select jsonb_agg(row_to_json(d) order by d.day) from (
      select (created_at at time zone 'utc')::date as day, provider, sum(micro_usd)::bigint as micro_usd from spend group by 1, 2) d), '[]'::jsonb),
    'by_provider', coalesce((select jsonb_agg(row_to_json(p) order by p.micro_usd desc) from (
      select provider, sum(micro_usd)::bigint as micro_usd, count(*) as calls from spend group by provider) p), '[]'::jsonb),
    'by_kind', coalesce((select jsonb_agg(row_to_json(k) order by k.micro_usd desc) from (
      select kind, sum(micro_usd)::bigint as micro_usd, count(*) as calls from spend group by kind) k), '[]'::jsonb),
    'top_founders', coalesce((select jsonb_agg(row_to_json(f) order by f.micro_usd desc) from (
      select s.user_id, coalesce(au.email, '(deleted)') as email, sum(s.micro_usd)::bigint as micro_usd
      from spend s left join auth.users au on au.id = s.user_id
      group by s.user_id, au.email order by 3 desc limit 20) f), '[]'::jsonb),
    'approved_cards', (select n from approved),
    'micro_usd_per_approved', case when (select n from approved) > 0
      then ((select coalesce(sum(micro_usd), 0) from spend) / (select n from approved))::bigint end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.provider_spend_report(integer) from public, anon;
grant execute on function public.provider_spend_report(integer) to authenticated;

commit;
