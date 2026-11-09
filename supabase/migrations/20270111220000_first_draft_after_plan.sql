-- Code review of cmo-review-2 (2026-11-09), R4. The first week's draft was queued by the `after()` that ran the
-- onboarding plan, only when that same call saw the plan done. When Modal's sweep claimed the plan first, the check saw
-- it running and the founder got no draft until the next daily loop. The plan's own completion queues the draft now,
-- whoever ran it.

begin;

create or replace function public.cmo_first_draft_after_plan() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.kind = 'plan_week' and new.status = 'done' and old.status is distinct from 'done'
     and new.input->>'source' = 'onboarding' and new.input->>'brain' is distinct from 'claude' then
    begin
      perform public.cmo_enqueue(new.user_id, 'post_draft', jsonb_build_object('source', 'onboarding'));
    exception when others then
      -- A refused draft (paused CMO, no credits, daily limit) must not undo the plan; the daily loop drafts instead.
      raise warning 'first draft not queued for %: %', new.user_id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.cmo_first_draft_after_plan() from public, anon, authenticated;

drop trigger if exists cmo_runs_first_draft on public.cmo_runs;
create trigger cmo_runs_first_draft after update of status on public.cmo_runs
  for each row execute function public.cmo_first_draft_after_plan();

commit;
