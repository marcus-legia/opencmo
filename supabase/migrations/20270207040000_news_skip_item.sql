-- A planned post that found no news, and the morning fill's idea (plan 2026-11-27-content-plan-and-x-news.md, B6).
--
-- A post that must ride the news (or has nothing else to rest on: no Library source) and finds no story that fits
-- today is not written, and its credit comes back. Left `planned`, it would be due again tomorrow, go first in the
-- day's first wave and take one of the day's five drafts from a post planned for that day. So the draft run skips it,
-- with a reason the calendar can show (`no_news`, or `no_source` for a post with neither a source nor a story). Only a running draft of the same founder may: the one that names the item
-- (`input.item_id`), or one that names none and drafted the oldest due post.

begin;

create or replace function public.cmo_news_skip_item(p_user uuid, p_run uuid, p_item uuid, p_reason text default 'no_news') returns boolean
language plpgsql security definer
set search_path to ''
as $$
declare
  v_id uuid;
begin
  if p_reason is null or p_reason not in ('no_news', 'no_source') then
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

commit;
