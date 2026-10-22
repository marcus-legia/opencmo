-- 20261221100000: finish the clipping removal where 20261220090000 already ran.
--
-- Production applied 20261220090000 before its refund and video-pack job lines were added (PR #93),
-- and a migration that already ran is never run again. That version deleted video-pack project rows
-- but not their jobs. Every job gets its project row from `jobs_project` and nothing else deletes
-- one, so a job without a project row is exactly such a leftover: refund it if it was still in
-- flight (web rule 5; finished work keeps its charge), then delete it with its clips and storage.
--
-- Not done here: link jobs and video-pack runs that were deleted while in flight. With the row gone,
-- the ledger cannot tell their hold from a finished charge (a settle at the held amount writes no
-- row), and production had none in flight when the removal shipped (see 20261220090000's header).
--
-- A no-op where 20261220090000 ran in full, and safe to run again.

create or replace function public.remove_video_pack_leftovers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  perform public.refund_job(j.id, 'Refund: video packs were removed')
  from public.jobs j
  where j.status in ('queued', 'running')
    and not exists (select 1 from public.projects p where p.job_id = j.id);
  delete from public.jobs j
  where not exists (select 1 from public.projects p where p.job_id = j.id);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function public.remove_video_pack_leftovers() from public, anon, authenticated;

select public.remove_video_pack_leftovers();
