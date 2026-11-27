-- Fill today's empty post slots (owner, 2026-11-27; plan docs/superpowers/plans/2026-11-27-content-plan-and-x-news.md,
-- A6, decision 5).
--
-- The week plan writes Monday's skeleton. A slot of today with no post item, for example after the founder raised X
-- from 3 to 5 mid-week, gets a planned item here each morning, before the schedule queues the day's drafts. Its idea
-- is a stand-in: the draft writes the real one from the content plan in the same run (`planned_from: day_fill`), for
-- the draft's one credit and no plan charge.
--
-- `p_items` is the day's slots as the schedule reads the founder's running plan (`dayTargets(connectedOnly(plan))`):
-- `[{slot, targets}]`. A slot is taken by any post item that day with that slot, whatever its status: a skipped or
-- failed post is not drafted again. One call per founder and day at a time (an advisory lock), so a second call adds
-- nothing. Returns `{id, slot}` for each item it made, so the schedule knows each one's wave. Service role only.

begin;

create or replace function public.cmo_fill_day_slots(p_user uuid, p_day date, p_items jsonb)
returns setof jsonb
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_item jsonb;
  v_slot integer;
  v_targets jsonb;
  v_id uuid;
begin
  if p_user is null or p_day is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 5 then
    raise exception 'These slots are not valid.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cmo_fill_day_slots:' || p_user::text || ':' || p_day::text, 0));
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item->'slot') <> 'number' or (v_item->>'slot')::numeric not in (0, 1, 2, 3, 4) then
      continue;
    end if;
    v_slot := (v_item->>'slot')::int;
    v_targets := public.posting_plan_targets(v_item->'targets');
    if v_targets is null then
      continue;
    end if;
    if exists (select 1 from public.content_items
               where user_id = p_user and department = 'post' and day = p_day
                 and jsonb_typeof(body->'slot') = 'number' and (body->>'slot')::int = v_slot) then
      continue;
    end if;
    insert into public.content_items (user_id, department, platform, day, idea, reason, body)
    values (p_user, 'post', left(coalesce(public.platform_profile(v_targets->>0)->>'label', 'X'), 20), p_day,
      'Today''s post, from your content plan', 'A slot your posting plan has and the week plan did not fill.',
      jsonb_build_object('slot', v_slot, 'targets', v_targets, 'news', 'hook', 'planned_from', 'day_fill'))
    returning id into v_id;
    return next jsonb_build_object('id', v_id, 'slot', v_slot);
  end loop;
  return;
end;
$$;

revoke all on function public.cmo_fill_day_slots(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.cmo_fill_day_slots(uuid, date, jsonb) to service_role;

commit;
