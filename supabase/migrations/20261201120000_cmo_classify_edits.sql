-- The nightly edit classifier's two service-role RPCs (agent evals plan, P4).
--
-- `cmo_unclassified_outcomes` hands the classifier the drafted version the founder started from
-- and the text they approved, for approvals that were really edited; `cmo_set_edit_mode` writes
-- the label once. Neither is callable by users: the texts are read only by our own job.

create or replace function public.cmo_unclassified_outcomes(p_limit integer)
returns table (id uuid, draft text, final_text text)
language sql stable security definer set search_path = public as $$
  select o.id,
    case o.chosen_version when 0 then c.body->>'text' else c.body->'alternates'->>(o.chosen_version - 1) end,
    c.final_text
  from public.cmo_draft_outcomes o
  join public.content_items c on c.id = o.item_id and c.user_id = o.user_id
  where o.department = 'post' and o.action = 'approve' and o.classified_at is null
    and o.similarity is not null and o.chosen_version is not null and c.final_text is not null
  order by o.decided_at
  limit least(greatest(coalesce(p_limit, 0), 0), 100)
$$;

create or replace function public.cmo_set_edit_mode(p_id uuid, p_mode text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_mode is null or p_mode not in ('NO_MEANINGFUL_EDIT', 'TOO_SALESY', 'WRONG_VOICE', 'INVENTED_CLAIM',
                                      'TOO_LONG', 'HOOK_REWRITTEN', 'CTA_REMOVED', 'FULL_REWRITE') then
    raise exception 'Unknown edit mode.' using errcode = '22023';
  end if;
  update public.cmo_draft_outcomes set edit_mode = p_mode, classified_at = now()
  where id = p_id and classified_at is null;
  return found;
end;
$$;

revoke all on function public.cmo_unclassified_outcomes(integer) from public, anon, authenticated;
revoke all on function public.cmo_set_edit_mode(uuid, text) from public, anon, authenticated;
grant execute on function public.cmo_unclassified_outcomes(integer) to service_role;
grant execute on function public.cmo_set_edit_mode(uuid, text) to service_role;
