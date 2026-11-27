-- A planned post that found no news, and the morning fill's idea (plan 2026-11-27-content-plan-and-x-news.md, B6).
--
-- A post that must ride the news (or has nothing else to rest on: no Library source) and finds no story that fits
-- today is not written, and its credit comes back. Left `planned`, it would be due again tomorrow, go first in the
-- day's first wave and take one of the day's five drafts from a post planned for that day. So the draft run skips it,
-- with its reason in `body.skip_reason` (`no_news`; `no_source` for a post with neither a source nor a story;
-- `news_unreadable` when the news could not be read on its last chance); no screen reads it yet, the run's step says why. Only a running draft of the same founder may: the one that names the item
-- (`input.item_id`), or one that names none and drafted the oldest due post.

begin;

create or replace function public.cmo_news_skip_item(p_user uuid, p_run uuid, p_item uuid, p_reason text default 'no_news') returns boolean
language plpgsql security definer
set search_path to ''
as $$
declare
  v_id uuid;
begin
  if p_reason is null or p_reason not in ('no_news', 'no_source', 'news_unreadable') then
    raise exception 'Unknown skip reason.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.cmo_runs r
    where r.id = p_run and r.user_id = p_user and r.kind = 'post_draft' and r.status = 'running'
      -- A run that names no item drafts the founder's oldest due post, which is theirs (checked below).
      and (r.input->>'item_id' = p_item::text or r.input->>'item_id' is null)
  ) then
    return false;
  end if;
  update public.content_items
  set status = 'skipped', decided_at = now(), updated_at = now(),
      body = coalesce(body, '{}'::jsonb) || jsonb_build_object('skip_reason', p_reason)
  where id = p_item and user_id = p_user and department = 'post' and status = 'planned'
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.cmo_news_skip_item(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cmo_news_skip_item(uuid, uuid, uuid, text) to service_role;

-- The morning fill's item (Part A6) is saved with a stand-in idea; the draft plans the real one (Part B6 step 1) and
-- keeps it here, so the card, the calendar and the next fill's list of today's posts read it. Same guard as above.
create or replace function public.cmo_day_fill_idea(p_user uuid, p_run uuid, p_item uuid, p_idea text) returns boolean
language plpgsql security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_idea text := left(btrim(coalesce(p_idea, '')), 300);
begin
  if v_idea = '' then
    return false;
  end if;
  if not exists (
    select 1 from public.cmo_runs r
    where r.id = p_run and r.user_id = p_user and r.kind = 'post_draft' and r.status = 'running'
      and (r.input->>'item_id' = p_item::text or r.input->>'item_id' is null)
  ) then
    return false;
  end if;
  update public.content_items
  set idea = v_idea, updated_at = now()
  where id = p_item and user_id = p_user and department = 'post' and status = 'planned' and body->>'planned_from' = 'day_fill'
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.cmo_day_fill_idea(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cmo_day_fill_idea(uuid, uuid, uuid, text) to service_role;

-- Two drafts of one founder can run at once (a wave queues several), read the same snapshot and pick the same story.
-- The news a founder's posts have taken is one rule, in one place (`news_taken_by`), by news key and by X story id
-- (each snapshot's filter names the news afresh, so one story can come back under another key):
-- * a post that went to review or out (in review, approved, published) rode its story if it was drafted in the last
--   three days (`body.news.at`, the draft's time; an older draft's approval does not make its news taken again);
-- * a post a draft is writing holds its story (`body.news_topic`, `body.news_story`) while that draft runs on a live
--   lease, so a draft that failed, or whose worker died, holds nothing.
-- A stored ISO time, or null for anything that is not one: a bad value must never break a founder's drafts.
create or replace function public.news_time(p_text text) returns timestamptz
language plpgsql immutable
set search_path to ''
as $$
begin
  if p_text is null or p_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then
    return null;
  end if;
  return p_text::timestamptz;
exception when others then
  return null;
end;
$$;
revoke all on function public.news_time(text) from public, anon, authenticated;
grant execute on function public.news_time(text) to service_role;

create or replace function public.news_taken_by(p_user uuid, p_except uuid default null) returns table (keys text[], stories text[])
language sql stable security definer
set search_path to ''
as $$
  with taken as (
    select c.body->'news'->>'topicKey' as k, c.body->'news'->>'storyId' as s from public.content_items c
    where c.user_id = p_user and c.department = 'post' and c.id is distinct from p_except
      and c.status in ('in_review', 'approved', 'published') and jsonb_typeof(c.body->'news') = 'object'
      -- The draft's time; a story stored without one counts from the row's last change.
      and coalesce(public.news_time(c.body->'news'->>'at'), c.updated_at) > now() - interval '3 days'
    union all
    select c.body->>'news_topic', c.body->>'news_story' from public.content_items c
    where c.user_id = p_user and c.department = 'post' and c.id is distinct from p_except
      and c.status in ('planned', 'drafting') and coalesce(c.body->>'news_topic', '') <> ''
      -- A running draft holds on a live lease, or for 15 minutes from its reserve: the lease is renewed per step, and
      -- one long writer call must not let a draft beside it take the same story.
      and exists (select 1 from public.cmo_runs h
                  where h.id::text = c.body->>'news_topic_run' and h.status = 'running'
                    and (h.lease_until is null or h.lease_until > now()
                         or public.news_time(c.body->>'news_topic_at') > now() - interval '15 minutes'))
  )
  select coalesce(array_agg(distinct k) filter (where coalesce(k, '') <> ''), '{}'),
         coalesce(array_agg(distinct s) filter (where coalesce(s, '') <> ''), '{}')
  from taken;
$$;
revoke all on function public.news_taken_by(uuid, uuid) from public, anon, authenticated;
grant execute on function public.news_taken_by(uuid, uuid) to service_role;

-- What the draft leaves out before it asks the picker.
create or replace function public.cmo_news_taken(p_user uuid) returns jsonb
language sql stable security definer
set search_path to ''
as $$ select jsonb_build_object('keys', to_jsonb(t.keys), 'stories', to_jsonb(t.stories)) from public.news_taken_by(p_user) t; $$;
revoke all on function public.cmo_news_taken(uuid) from public, anon, authenticated;
grant execute on function public.cmo_news_taken(uuid) to service_role;

-- Before writing, a draft reserves its story on its item, under the founder's lock: refused when another of their
-- posts has taken the same news or the same story, so the draft takes its next pick. Same guard as above.
create or replace function public.cmo_news_reserve(p_user uuid, p_run uuid, p_item uuid, p_topic text, p_story text) returns boolean
language plpgsql security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_taken record;
begin
  if p_topic is null or p_topic !~ '^[a-z0-9-]{1,60}$' or p_story is null or p_story !~ '^[0-9]{1,19}$' then
    raise exception 'Invalid news key.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.cmo_runs r
    where r.id = p_run and r.user_id = p_user and r.kind = 'post_draft' and r.status = 'running'
      and (r.input->>'item_id' = p_item::text or r.input->>'item_id' is null)
  ) then
    return false;
  end if;
  perform public.lock_credit_owner(p_user);
  select * into v_taken from public.news_taken_by(p_user, p_item);
  if p_topic = any (v_taken.keys) or p_story = any (v_taken.stories) then
    return false;
  end if;
  update public.content_items
  set body = coalesce(body, '{}'::jsonb) || jsonb_build_object('news_topic', p_topic, 'news_story', p_story, 'news_topic_run', p_run,
             'news_topic_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      updated_at = now()
  where id = p_item and user_id = p_user and department = 'post' and status in ('planned', 'drafting')
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.cmo_news_reserve(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.cmo_news_reserve(uuid, uuid, uuid, text, text) to service_role;

commit;
