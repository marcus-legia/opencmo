-- A planned post that found no news (plan 2026-11-27-content-plan-and-x-news.md, Part B6).
--
-- A post that must ride the news (or has nothing else to rest on: no Library source) and finds no story that fits
-- today is not written, and its credit comes back. Left `planned`, it would be due again tomorrow, go first in the
-- day's first wave and take one of the day's five drafts from a post planned for that day. So the draft run skips it,
-- with a reason the calendar can show. Only a running draft of the same founder may: the one that names the item
-- (`input.item_id`), or one that names none and drafted the oldest due post.

begin;

create or replace function public.cmo_news_skip_item(p_user uuid, p_run uuid, p_item uuid) returns boolean
language plpgsql security definer
set search_path to ''
as $$
declare
  v_id uuid;
begin
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
      body = coalesce(body, '{}'::jsonb) || jsonb_build_object('skip_reason', 'no_news')
  where id = p_item and user_id = p_user and department = 'post' and status = 'planned'
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.cmo_news_skip_item(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cmo_news_skip_item(uuid, uuid, uuid) to service_role;

commit;
