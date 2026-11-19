-- Review of #238, finding 6: a free-scan card whose community's rules now read "skip" was left undrafted for good, so
-- the "Write the replies" banner never went away and every click ran an empty job. The job now marks such a card
-- `skip` (with the community's own words), which takes it out of the cards that wait for a reply.
create function public.cmo_mark_opportunity_skip(p_user uuid, p_run uuid, p_id uuid, p_why text)
returns boolean
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.cmo_runs r where r.id = p_run and r.user_id = p_user and r.kind = 'sales_reply_drafts'
  ) then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  update public.opportunities o set
    rule = 'skip',
    rule_why = left(nullif(btrim(coalesce(p_why, '')), ''), 200)
  where o.id = p_id and o.user_id = p_user and o.status = 'in_review' and o.reply = '' and o.rule is distinct from 'skip';
  return found;
end;
$$;

revoke all on function public.cmo_mark_opportunity_skip(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cmo_mark_opportunity_skip(uuid, uuid, uuid, text) to service_role;
