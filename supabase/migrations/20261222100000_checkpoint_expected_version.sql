-- 20261222100000: a checkpoint can be tied to the version its caller read.
--
-- restore_version (MCP) checkpoints the current edit, then saves the old one behind the optimistic
-- lock. When the editor saved in between, the save failed with 409 but the checkpoint stayed: a
-- "before restoring" version in Version history for a restore that never happened, one more per
-- retry. With `p_expected_version` the checkpoint refuses the same way the save would, before
-- anything is written. Callers that pass nothing checkpoint as before.

begin;

drop function if exists public.checkpoint_editor_project(uuid, text, text);

create or replace function public.checkpoint_editor_project(
  p_clip_id uuid, p_kind text, p_label text, p_expected_version integer default null
) returns public.editor_revisions
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_row public.editor_projects;
  v_hash text;
  v_latest public.editor_revisions;
  v_revision public.editor_revisions;
begin
  if p_kind is null or p_kind not in ('agent', 'manual') then
    raise exception 'Invalid checkpoint kind.' using errcode = '22023';
  end if;
  if p_label is null or char_length(trim(p_label)) = 0 or char_length(p_label) > 200 then
    raise exception 'A checkpoint needs a short label.' using errcode = '22023';
  end if;

  perform public.owned_clip(p_clip_id, v_user);

  select p.* into v_row
  from public.editor_projects p
  where p.clip_id = p_clip_id
  for update;

  if not found then
    raise exception 'This clip has no editor project yet.' using errcode = 'P0002';
  end if;
  -- Same refusal as save_editor_document: the write that follows would fail on this version.
  if p_expected_version is not null and v_row.version is distinct from p_expected_version then
    raise exception 'This clip was changed in another tab.' using errcode = 'P0409';
  end if;

  v_hash := public.editor_document_hash(v_row.document);

  select r.* into v_latest
  from public.editor_revisions r
  where r.clip_id = p_clip_id
  order by r.number desc
  limit 1;

  if found and v_latest.source_hash = v_hash and v_latest.kind = p_kind then
    return v_latest;
  end if;

  insert into public.editor_revisions (clip_id, number, source_hash, document, kind, label)
  values (p_clip_id, coalesce(v_latest.number, 0) + 1, v_hash, v_row.document, p_kind, trim(p_label))
  returning * into v_revision;

  return v_revision;
end;
$$;
revoke execute on function public.checkpoint_editor_project(uuid, text, text, integer) from public, anon;
grant execute on function public.checkpoint_editor_project(uuid, text, text, integer) to authenticated;

commit;
