-- cmo-review B2.6: a Studio card sent back teaches the next brief.
--
-- Sending back a finished video, a batch of shorts or a slideshow failed its order with the reason (the progress
-- check replans it) and kept the reason on the card, but wrote no memory: next week's video brief made the same
-- video again. Writer's video brief reads topic 'video' memories (`writerMemory`), so the reason goes there, as the
-- founder's own feedback. `approval_decide` writes `reason` after the status, so this follows the reason.

create or replace function public.approvals_studio_lesson()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_what text;
  v_title text;
begin
  if new.kind not in ('finished_video', 'shorts_batch', 'slideshow') or new.status <> 'skipped'
     or new.reason is null or char_length(trim(new.reason)) = 0
     or (old.reason is not distinct from new.reason and old.status = new.status) then
    return new;
  end if;
  v_what := case new.kind when 'finished_video' then 'the video' when 'shorts_batch' then 'the shorts' else 'the slideshow' end;
  v_title := nullif(trim(coalesce(new.snapshot->>'title', '')), '');
  -- At the cap (200, as cmo_remember), the least important, oldest note goes.
  if (select count(*) from public.cmo_memories where user_id = new.user_id) >= 200 then
    delete from public.cmo_memories where id in (
      select id from public.cmo_memories where user_id = new.user_id order by importance, created_at limit 1);
  end if;
  insert into public.cmo_memories (user_id, type, kind, topic, importance, body)
  -- type 'feedback': cmo_memories_classify files it as the founder's feedback.
  values (new.user_id, 'feedback', 'preference', 'video', 3,
    left('Sent back ' || v_what || coalesce(' “' || left(v_title, 120) || '”', '') || ': ' || trim(new.reason), 600));
  return new;
exception when others then
  -- A memory is a lesson, never a reason to lose the founder's decision.
  raise warning 'studio lesson for card % not written: %', new.id, sqlerrm;
  return new;
end;
$$;
revoke all on function public.approvals_studio_lesson() from public, anon, authenticated;

drop trigger if exists approvals_studio_lesson on public.approvals;
create trigger approvals_studio_lesson after update of status, reason on public.approvals
  for each row execute function public.approvals_studio_lesson();
