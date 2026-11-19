-- Wave 3 A3 (docs/plans/cmo/2026-11-20-wave3-plan.md §5, §6, §9): each person Sales found gets a status the founder
-- moves (found → replied → answered back → talking → signed up → customer, or not interested), the link of the
-- founder's reply, a reach level read from the post and its thread only (never a profile), a DM draft for a DM-ready
-- person and a nudge after 4 days with no answer. Ferreto sends nothing: these are drafts the founder copies.

alter table public.opportunities
  add column person_status text not null default 'found'
    check (person_status in ('found', 'replied', 'answered_back', 'talking', 'signed_up', 'customer', 'not_interested')),
  add column status_at timestamptz,
  add column reply_url text check (char_length(reply_url) <= 500),
  add column replied_at timestamptz,
  add column reach_level text not null default 'reply_first'
    check (reach_level in ('reply_first', 'dm_ready', 'email_ready')),
  add column reach jsonb not null default '{}'::jsonb
    check (jsonb_typeof(reach) = 'object' and octet_length(reach::text) <= 2048),
  add column dm_draft text check (char_length(dm_draft) <= 1000),
  add column dm_drafted_at timestamptz,
  add column nudge_draft text check (char_length(nudge_draft) <= 1000),
  add column nudge_drafted_at timestamptz;

-- The cards already marked replied are people the founder replied to.
update public.opportunities set person_status = 'replied', replied_at = decided_at, status_at = decided_at
where status = 'replied' and person_status = 'found';
update public.opportunities o set reply_url = d.outcome_url
from public.cmo_draft_outcomes d
where d.department = 'sales' and d.item_id = o.id and d.action = 'replied' and d.outcome_url is not null and o.reply_url is null;

create index opportunities_user_person_idx on public.opportunities (user_id, person_status, status_at desc);

-- Whatever marks a card replied (the card's button, the chat, `opportunity_mark_replied`), the person moves to
-- Following up once.
create function public.opportunities_person_replied()
returns trigger
  language plpgsql
  set search_path to ''
as $$
begin
  if new.status = 'replied' and old.status is distinct from 'replied' and new.person_status = 'found' then
    new.person_status := 'replied';
    new.replied_at := coalesce(new.replied_at, now());
    new.status_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.opportunities_person_replied() from public, anon, authenticated;

create trigger opportunities_person_replied before update of status on public.opportunities
  for each row execute function public.opportunities_person_replied();

-- Whether `p_url` is a link to a reply in the thread `p_opp` points at (the same site, and for Reddit and Facebook
-- the same thread or group), so a funnel row never points somewhere else.
create function public.reply_url_fits(p_platform text, p_thread text, p_url text)
returns boolean
  language sql immutable
  set search_path to ''
as $$
  select char_length(p_url) <= 500 and p_url !~ '\s' and case p_platform
    when 'reddit' then p_url ~ '^https://(www\.|old\.)?reddit\.com/r/'
      and position(rtrim(regexp_replace(p_thread, '^https://(www\.|old\.)?reddit\.com', ''), '/') || '/'
                   in regexp_replace(p_url, '^https://(www\.|old\.)?reddit\.com', '')) = 1
    when 'hn' then p_url ~ '^https://news\.ycombinator\.com/item\?id=[0-9]{1,12}$'
    when 'facebook' then p_url ~ '^https://www\.facebook\.com/groups/'
      and split_part(regexp_replace(p_url, '^https://www\.facebook\.com/groups/', ''), '/', 1)
        = split_part(regexp_replace(p_thread, '^https://www\.facebook\.com/groups/', ''), '/', 1)
    when 'threads' then p_url ~ '^https://www\.threads\.com/@[A-Za-z0-9._]{1,30}/post/[A-Za-z0-9_-]{1,40}/?$'
    else false
  end;
$$;
revoke all on function public.reply_url_fits(text, text, text) from public, anon, authenticated;

-- "I replied": the founder pastes the link of the reply they posted. A card still in review is marked replied the
-- same way its button does (`cmo_decide_opportunity`); the link is kept on the person and on the draft's outcome,
-- where `reply-outcomes` re-reads it.
create function public.opportunity_mark_replied(p_id uuid, p_url text)
returns public.opportunities
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_opp public.opportunities;
  v_url text := btrim(coalesce(p_url, ''));
begin
  select * into v_opp from public.opportunities o where o.id = p_id and o.user_id = v_user;
  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  if v_opp.status = 'dismissed' then
    raise exception 'You dismissed this conversation.' using errcode = 'P0001';
  end if;
  if not public.reply_url_fits(v_opp.platform, v_opp.url, v_url) then
    raise exception 'Paste the link to your reply in this thread.' using errcode = '22023';
  end if;
  if v_opp.status = 'in_review' then
    perform public.cmo_decide_opportunity(p_id, 'replied');
  end if;
  update public.opportunities o set
    reply_url = v_url,
    replied_at = coalesce(o.replied_at, now()),
    person_status = case when o.person_status = 'found' then 'replied' else o.person_status end,
    status_at = case when o.person_status = 'found' then now() else o.status_at end
  where o.id = p_id
  returning * into v_opp;
  update public.cmo_draft_outcomes d set outcome_url = v_url
  where d.user_id = v_user and d.department = 'sales' and d.item_id = p_id and d.action = 'replied';
  return v_opp;
end;
$$;
revoke all on function public.opportunity_mark_replied(uuid, text) from public, anon;
grant execute on function public.opportunity_mark_replied(uuid, text) to authenticated;

-- The older link-only RPC (P5) keeps working for the current screen, with the wider link check.
create or replace function public.opportunity_reply_url(p_id uuid, p_url text)
returns void
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.opportunities o where o.id = p_id and o.user_id = public.require_user() and o.status = 'replied'
  ) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  perform public.opportunity_mark_replied(p_id, p_url);
end;
$$;

-- The founder moves a person along Following up (or back). "Replied" needs the reply first: it goes through
-- "I replied" (`opportunity_mark_replied`) or the card's button.
create function public.opportunity_set_status(p_id uuid, p_status text)
returns public.opportunities
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_opp public.opportunities;
begin
  if p_status is null or p_status not in ('found', 'replied', 'answered_back', 'talking', 'signed_up', 'customer', 'not_interested') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  select * into v_opp from public.opportunities o where o.id = p_id and o.user_id = v_user;
  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  if p_status not in ('found', 'not_interested') and v_opp.status <> 'replied' then
    raise exception 'Mark that you replied first.' using errcode = 'P0001';
  end if;
  update public.opportunities o set person_status = p_status, status_at = now()
  where o.id = p_id and o.person_status is distinct from p_status
  returning * into v_opp;
  if not found then
    select * into v_opp from public.opportunities o where o.id = p_id;
  end if;
  return v_opp;
end;
$$;
revoke all on function public.opportunity_set_status(uuid, text) from public, anon;
grant execute on function public.opportunity_set_status(uuid, text) to authenticated;

-- The scan's reach check, per conversation url (B1). The level is worked out here from the checks, not taken from the
-- item, so the screen and the rule in apps/web/lib/cmo/reach.ts cannot disagree; Hacker News has no DMs. A DM draft
-- (`dm`, optional) is kept only for a DM-ready person, at most 20 a day per founder; the rest are skipped.
create function public.cmo_save_reach(p_user uuid, p_run uuid, p_items jsonb)
returns integer
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_item jsonb;
  v_r jsonb;
  v_opp public.opportunities;
  v_dm boolean;
  v_email text;
  v_level text;
  v_reach jsonb;
  v_text text;
  v_today integer;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.cmo_runs r where r.id = p_run and r.user_id = p_user and r.kind in ('sales_scan', 'sales_reply_drafts')
  ) then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'These reach checks are not valid.' using errcode = '22023';
  end if;
  select count(*)::integer into v_today from public.opportunities o
  where o.user_id = p_user and o.dm_drafted_at > now() - interval '1 day';

  for v_item in select * from jsonb_array_elements(p_items) loop
    continue when jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'reach') <> 'object';
    select * into v_opp from public.opportunities o where o.user_id = p_user and o.url = v_item->>'url';
    continue when not found;
    v_r := v_item->'reach';
    v_email := nullif(btrim(coalesce(v_r->>'emailFound', '')), '');
    if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      v_email := null;
    end if;
    v_reach := jsonb_build_object(
      'buyer', coalesce(v_r->'buyer' = 'true'::jsonb, false),
      'wantsNow', coalesce(v_r->'wantsNow' = 'true'::jsonb, false),
      'warm', coalesce(v_r->'warm' = 'true'::jsonb, false),
      'fresh', coalesce(v_r->'fresh' = 'true'::jsonb, false),
      'dmAllowed', coalesce(v_r->'dmAllowed' = 'true'::jsonb, false) and v_opp.platform <> 'hn',
      'asksForTools', coalesce(v_r->'asksForTools' = 'true'::jsonb, false),
      'emailFound', v_email,
      'reasons', coalesce((
        select jsonb_agg(left(btrim(x), 160)) from (
          select x from jsonb_array_elements_text(case when jsonb_typeof(v_r->'reasons') = 'array' then v_r->'reasons' else '[]'::jsonb end) x
          where btrim(x) <> '' limit 8
        ) s), '[]'::jsonb));
    v_dm := (v_reach->>'buyer')::boolean and (v_reach->>'wantsNow')::boolean and (v_reach->>'fresh')::boolean
      and (v_reach->>'dmAllowed')::boolean and ((v_reach->>'warm')::boolean or (v_reach->>'asksForTools')::boolean);
    v_level := case when not v_dm then 'reply_first'
      when v_email is not null and (v_reach->>'warm')::boolean then 'email_ready' else 'dm_ready' end;
    v_text := left(nullif(btrim(coalesce(v_item->>'dm', '')), ''), 1000);
    if v_text is not null and (not v_dm or v_today >= 20 or v_opp.dm_draft is not null) then
      v_text := null;
    end if;
    update public.opportunities o set
      reach = v_reach,
      reach_level = v_level,
      dm_draft = coalesce(v_text, o.dm_draft),
      dm_drafted_at = case when v_text is not null then now() else o.dm_drafted_at end
    where o.id = v_opp.id;
    if v_text is not null then
      v_today := v_today + 1;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.cmo_save_reach(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cmo_save_reach(uuid, uuid, jsonb) to service_role;

-- A nudge for a person the founder replied to who has not answered in 4 days (B2). One per person; the founder sends it.
create function public.cmo_save_nudge(p_user uuid, p_run uuid, p_id uuid, p_text text)
returns boolean
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_text text := left(nullif(btrim(coalesce(p_text, '')), ''), 1000);
begin
  if not exists (select 1 from public.cmo_runs r where r.id = p_run and r.user_id = p_user) then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  if v_text is null then
    return false;
  end if;
  update public.opportunities o set nudge_draft = v_text, nudge_drafted_at = now()
  where o.id = p_id and o.user_id = p_user and o.person_status = 'replied' and o.nudge_draft is null
    and o.replied_at < now() - interval '4 days';
  return found;
end;
$$;
revoke all on function public.cmo_save_nudge(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cmo_save_nudge(uuid, uuid, uuid, text) to service_role;

-- `reply-outcomes` saw someone answer the founder (B6): the person moves to answered back, never backwards.
create function public.cmo_mark_answered_back(p_user uuid, p_id uuid)
returns boolean
  language plpgsql security definer
  set search_path to ''
as $$
begin
  update public.opportunities o set person_status = 'answered_back', status_at = now()
  where o.id = p_id and o.user_id = p_user and o.person_status = 'replied';
  return found;
end;
$$;
revoke all on function public.cmo_mark_answered_back(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cmo_mark_answered_back(uuid, uuid) to service_role;

-- B1: the community's rules say no DMs or soliciting; `dmAllowed` reads it.
alter table public.subreddit_rules add column no_dms boolean not null default false;
