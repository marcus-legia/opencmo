-- CMO review 3, A3: the paywall on decisions (plan §2, §5.1). The first run is free; the first thing that sends a post
-- out asks for a plan: approving a post (its words and its time, 1.2), approving or retrying a slot, and "I posted it".
--
-- The rule sits on the rows, not on each RPC: a post goes out only through `content_items` (post) becoming `approved`
-- or `published`, or a `schedule_slots` row becoming `waiting` or `published`. `approval_decide`, `cmo_decide_post`,
-- `cmo_post_myself`, `cmo_mark_posted`, `schedule_mark_posted`, MCP and any later path all write those rows, so one
-- check covers them and cannot be forgotten when one of those functions is replaced again.
--
-- Only a founder's own write is checked (`auth.uid()` set, as for the app, the API and MCP's user token). Crons, the
-- worker and webhooks run without a user and are never stopped here: a slot approved while paid still goes out.
-- Skipping, dismissing, editing words, changing a time and approving a script stay free: none of them sends anything.
-- The refusal is `cmo_plan_required` (P0402 → HTTP 402 `plan_required`, B0), so the card opens the plan sheet.

create or replace function public.paywall_on_send() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if tg_table_name = 'content_items' then
    if new.department <> 'post' or new.status not in ('approved', 'published') then
      return new;
    end if;
  elsif new.status not in ('waiting', 'published') then
    return new;
  end if;
  if not public.cmo_paid(new.user_id) then
    perform public.cmo_plan_required();
  end if;
  return new;
end;
$$;

revoke all on function public.paywall_on_send() from public, anon, authenticated;

drop trigger if exists content_items_paywall on public.content_items;
create trigger content_items_paywall before update of status on public.content_items
  for each row execute function public.paywall_on_send();

drop trigger if exists schedule_slots_paywall on public.schedule_slots;
create trigger schedule_slots_paywall before insert or update of status on public.schedule_slots
  for each row execute function public.paywall_on_send();
