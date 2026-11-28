-- A post card that waits past the time it proposes gets the next free time (28/11 review).
--
-- A card's time is picked once, when the post enters review (`content_items_post_proposal`), and kept while it waits.
-- A card left overnight still showed yesterday's time, and approving it then answered "The time you approved has
-- passed" with a second card to decide. The hourly CMO cron calls this: every waiting post whose time is within the
-- lead of now gets a new one from `post_proposal`, and `approvals_sync` raises the card again with it (the old card
-- is superseded, as a changed time is). No free time in the horizon drops the time: the card then gets its time
-- after approval, as before 1.2.
create or replace function public.post_refresh_proposals(p_limit integer default 500) returns integer
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_lead interval := make_interval(mins => (public.schedule_rules()->>'leadMinutes')::integer);
  v_row record;
  v_new jsonb;
  v_n integer := 0;
begin
  for v_row in
    select c.id, c.user_id, c.platform from public.content_items c
    where c.department = 'post' and c.status = 'in_review'
      and public.post_proposed_at(c.body) < now() + v_lead
    order by public.post_proposed_at(c.body), c.id
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
    for update of c skip locked
  loop
    begin
      v_new := public.post_proposal(v_row.user_id, v_row.platform, v_row.id);
    exception when others then
      -- A time is a convenience on the card: one founder's failure never stops the others' refresh.
      raise warning 'post proposal refresh for content item % failed: %', v_row.id, sqlerrm;
      v_new := null;
    end;
    -- A null proposal is stripped by the trigger, which then leaves the card without a time.
    update public.content_items set body = jsonb_set(body, '{proposed}', coalesce(v_new, 'null'::jsonb)), updated_at = now()
    where id = v_row.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.post_refresh_proposals(integer) from public, anon, authenticated;
grant execute on function public.post_refresh_proposals(integer) to service_role;
