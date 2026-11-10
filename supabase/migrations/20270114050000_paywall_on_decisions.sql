-- CMO review 3, A3: the paywall on decisions (plan §2, §5.1). The first run is free; the first thing that sends a post
-- out asks for a plan: approving a post (its words and its time, 1.2), "I posted it" on a post still waiting, and
-- approving or retrying a slot. Dated after B0 (20270114010000), whose `cmo_paid` and `cmo_plan_required` it calls.
--
-- The rule sits on the rows, not on each RPC: a post leaves only through a post item entering `approved` or
-- `published` from a state before approval, or a slot entering a sending state from `proposed` (or from `failed`, a
-- Retry). `approval_decide`, `cmo_decide_post`, `cmo_post_myself`, MCP and later paths all write those rows, so one
-- check covers them when any of those functions is replaced again.
--
-- What already went out stays bookable: a post approved while paid can still be marked posted after the plan lapses
-- (approved → published, a reminded or unconfirmed slot → published). Only a founder's own write is checked
-- (`auth.uid()` set: the app, the API and MCP's user token); crons, the worker and webhooks run without a user.
-- Skipping, editing words, changing a time and approving a script (video) stay free: none of them sends anything.
-- The refusal is `cmo_plan_required` (P0402 → HTTP 402 `plan_required`, B0), so the card opens the plan sheet.

create or replace function public.paywall_on_send() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_old text := case when tg_op = 'UPDATE' then old.status end;
  v_sends boolean;
begin
  if auth.uid() is null or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
    return new;
  end if;
  if tg_table_name = 'content_items' then
    v_sends := new.department = 'post' and new.status in ('approved', 'published')
      and (v_old is null or v_old not in ('approved', 'published'));
  else
    v_sends := new.status in ('waiting', 'due', 'reminded', 'publishing', 'published')
      and (v_old is null or v_old = 'proposed' or (v_old = 'failed' and new.status <> 'published'));
  end if;
  if v_sends and not public.cmo_paid(new.user_id) then
    perform public.cmo_plan_required();
  end if;
  return new;
end;
$$;

revoke all on function public.paywall_on_send() from public, anon, authenticated;

drop trigger if exists content_items_paywall on public.content_items;
create trigger content_items_paywall before insert or update of status on public.content_items
  for each row execute function public.paywall_on_send();

drop trigger if exists schedule_slots_paywall on public.schedule_slots;
create trigger schedule_slots_paywall before insert or update of status on public.schedule_slots
  for each row execute function public.paywall_on_send();
