-- A core post is `published` once its last slot is over. Two holes in 20270120070000 (database review, 2026-11-13):
--
-- 1. A race. publish_status locked only its own slot, then asked post_slots_open about the others. X, Threads and
--    Facebook post at the same minute by default: when two results commit together, each transaction still reads
--    the other slot as 'publishing', neither marks the post, and it stays 'approved' for good.
-- 2. A slot that ends 'failed' with no card left (its Retry card dismissed or expired, or no card raised) never
--    settled the post: only a cancellation did.
--
-- One helper now settles a post, under a per-post advisory lock held to commit, so two settles of the same post run
-- one after the other and the second reads the first's committed slot. It runs from deferred triggers, at commit,
-- because a failure raises its Retry card after the slot update in the same transaction: an immediate check would
-- settle the post before the card exists. The inline updates in publish_status and schedule_mark_posted stay as they
-- are; the helper is idempotent behind them.

create or replace function public.post_settle(p_deliverable uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid;
begin
  select ref_id into v_item from public.deliverables where id = p_deliverable and ref_kind = 'content_item';
  if v_item is null then
    return;
  end if;
  -- An advisory lock, not the deliverable row: other flows lock deliverables before slots, and this runs after a slot
  -- lock, so a row lock here could deadlock against them.
  perform pg_advisory_xact_lock(hashtextextended('post-settle:' || p_deliverable::text, 0));
  -- A new statement after the wait: in READ COMMITTED it reads what the other settle committed.
  update public.content_items c
  set status = 'published', published_at = coalesce(c.published_at, now()), updated_at = now(),
      external_url = coalesce(c.external_url, (select s.external_url from public.schedule_slots s
        where s.deliverable_id = p_deliverable and s.status = 'published' and s.external_url is not null
        order by s.published_at desc nulls last limit 1))
  where c.id = v_item and c.status = 'approved'
    and exists (select 1 from public.schedule_slots s where s.deliverable_id = p_deliverable and s.status = 'published')
    and not public.post_slots_open(p_deliverable, '00000000-0000-0000-0000-000000000000');
end;
$$;
revoke all on function public.post_settle(uuid) from public, anon, authenticated;

-- The cancellation rule of 20270120070000, through the helper (immediate, as before: nothing is raised after a cancel).
create or replace function public.schedule_slots_settle_post() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform public.post_settle(new.deliverable_id);
  end if;
  return new;
end;
$$;
revoke all on function public.schedule_slots_settle_post() from public, anon, authenticated;

create or replace function public.schedule_slots_settle_post_at_commit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.post_settle(new.deliverable_id);
  return null;
end;
$$;
revoke all on function public.schedule_slots_settle_post_at_commit() from public, anon, authenticated;

drop trigger if exists schedule_slots_settle_post_at_commit on public.schedule_slots;
create constraint trigger schedule_slots_settle_post_at_commit after update of status on public.schedule_slots
  deferrable initially deferred for each row
  when (new.status in ('published', 'failed', 'cancelled') and old.status is distinct from new.status)
  execute function public.schedule_slots_settle_post_at_commit();

-- A failed slot stays open while its card waits; when the card is decided or expires, the slot may be the last one.
create or replace function public.approvals_settle_post_at_commit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deliverable uuid;
begin
  select deliverable_id into v_deliverable from public.schedule_slots where id = new.ref_id;
  if v_deliverable is not null then
    perform public.post_settle(v_deliverable);
  end if;
  return null;
end;
$$;
revoke all on function public.approvals_settle_post_at_commit() from public, anon, authenticated;

drop trigger if exists approvals_settle_post_at_commit on public.approvals;
create constraint trigger approvals_settle_post_at_commit after update of status on public.approvals
  deferrable initially deferred for each row
  when (new.ref_kind = 'schedule_slot' and old.status = 'waiting' and new.status <> 'waiting')
  execute function public.approvals_settle_post_at_commit();
