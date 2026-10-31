-- 20261230110000: P4 A3, the event rule that hands approved work to Schedule (docs/plans/cmo/
-- 2026-10-28-p4-schedule-publish-plan.md F3, schedule-publish.md §4).
--
-- An approved post (its deliverable decided, its row approved) and an approved short (its deliverable made when the
-- batch is approved, its captions approved by the same card) get proposed slots and schedule cards. The batch
-- inserts the shorts' deliverables before its captions are approved, so the rule runs on both: whichever comes last
-- finds everything in place. A post marked posted by hand drops its slots still waiting, so it never goes out twice.

begin;

create or replace function public.schedule_follow_deliverable() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.kind = 'post' and new.status = 'decided' and (tg_op = 'INSERT' or old.status is distinct from 'decided'))
     or (new.kind = 'short' and tg_op = 'INSERT') then
    begin
      perform public.schedule_propose(new.id);
    exception when others then
      -- Scheduling is never a reason to undo the founder's approval of the work itself.
      raise warning 'schedule rule for deliverable % failed: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.schedule_follow_deliverable() from public, anon, authenticated;
create trigger schedule_follow_deliverable after insert or update of status on public.deliverables
  for each row execute function public.schedule_follow_deliverable();

create or replace function public.schedule_follow_content() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_deliverable uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  begin
    if new.status = 'approved' and new.department = 'video' and new.clip_id is not null then
      select id into v_deliverable from public.deliverables
      where ref_kind = 'clip' and ref_id = new.clip_id and kind = 'short' and user_id = new.user_id;
      if v_deliverable is not null then
        perform public.schedule_propose(v_deliverable);
      end if;
    elsif new.status = 'published' and new.department = 'post' then
      -- Posted by hand (copy and open, or marked posted): what still waits for its time is dropped with its card.
      update public.approvals a set status = 'cancelled', decided_at = now()
      from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
      where a.ref_kind = 'schedule_slot' and a.ref_id = s.id and a.status = 'waiting'
        and d.ref_kind = 'content_item' and d.ref_id = new.id and s.status in ('proposed', 'waiting');
      update public.schedule_slots s set status = 'cancelled', updated_at = now()
      from public.deliverables d
      where d.id = s.deliverable_id and d.ref_kind = 'content_item' and d.ref_id = new.id
        and s.status in ('proposed', 'waiting');
    end if;
  exception when others then
    raise warning 'schedule rule for content item % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.schedule_follow_content() from public, anon, authenticated;
create trigger schedule_follow_content after update of status on public.content_items
  for each row execute function public.schedule_follow_content();

commit;
