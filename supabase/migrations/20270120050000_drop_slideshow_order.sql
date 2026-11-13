-- Remove the CMO-built slideshow (daily core drafts D7, owner 2026-11-12): a slideshow is the founder's own photos
-- (TikTok Photo Mode, Instagram carousel) and the CMO writes only its caption.
--
-- 1. `work_orders_plan_week` no longer orders `write_slides` + `build_slideshow` for a Slideshow item.
-- 2. Slideshow orders the loop queued and that have not started are cancelled, with the slides order before them; a
--    `write_slides` run still queued fails and its held credits come back (`cmo_refund_run`).
-- Slideshow edits and cards already made stay: the founder can still open, render again and post them.
-- Redeclares `work_orders_plan_week` of 20261231110000; its grants are kept.

create or replace function public.work_orders_plan_week(p_user uuid, p_run uuid) RETURNS public.work_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_week date := date_trunc('week', current_date)::date;
  v_root public.work_orders;
  v_item record;
  v_free integer;
  v_price integer;
  v_brief public.work_orders;
  v_due timestamptz;
  v_run public.cmo_runs;
  v_niche public.work_orders;
begin
  v_root := public.work_order_week_root(p_user);
  update public.work_orders set run_id = coalesce(run_id, p_run), updated_at = now() where id = v_root.id returning * into v_root;
  if v_root.status = 'queued' then
    v_root := public.work_order_move(v_root.id, 'running', 'Planned the week');
  end if;

  -- Posts and Reddit scans whose calendar item the new plan deleted.
  for v_item in
    select id from public.work_orders where root_id = v_root.id and item_id is null and run_id is null
      and kind in ('post_draft', 'sales_scan') and status = 'queued' and created_by = 'loop' and id <> v_root.id
  loop
    perform public.work_order_move(v_item.id, 'cancelled', 'Dropped from the new plan');
  end loop;
  -- The replan deleted the item of a video already ordered (its order lost `item_id`, whether under way or still
  -- waiting on its brief): a new video item is that same video, not a second one this week.
  for v_item in
    select c.id from public.content_items c
    where c.user_id = p_user and c.run_id = p_run and c.status = 'planned' and c.department = 'video'
      and c.platform <> 'Slideshow'
      and c.clip_id is null and not exists (select 1 from public.work_orders o where o.item_id = c.id)
    order by c.day, c.created_at
  loop
    update public.work_orders set item_id = v_item.id, updated_at = now()
    where id = (select b.id from public.work_orders b where b.root_id = v_root.id and b.kind = 'write_video_brief'
                  and b.item_id is null and b.created_by = 'loop' and b.status not in ('done', 'failed', 'cancelled')
                  and not exists (select 1 from public.work_orders v where v.root_id = v_root.id and b.id = any(v.depends_on)
                                  and v.status not in ('done', 'failed', 'cancelled'))
                order by b.created_at, b.title limit 1);
  end loop;
  -- Videos the new plan dropped that have not started.
  for v_item in
    select id from public.work_orders where root_id = v_root.id and item_id is null and run_id is null
      and kind = 'build_video' and status = 'queued' and created_by = 'loop'
  loop
    perform public.work_order_move(v_item.id, 'cancelled', 'Dropped from the new plan');
  end loop;
  -- Slideshows the new plan dropped that have not started (cmo-review B2.3).
  for v_item in
    select id from public.work_orders where root_id = v_root.id and item_id is null and run_id is null
      and kind = 'build_slideshow' and status = 'queued' and created_by = 'loop'
  loop
    perform public.work_order_move(v_item.id, 'cancelled', 'Dropped from the new plan');
  end loop;
  -- A brief or slides not started yet whose every video or slideshow was dropped, and its run, which would still run
  -- and charge.
  for v_item in
    select b.id, b.kind from public.work_orders b
    where b.root_id = v_root.id and b.kind in ('write_video_brief', 'write_slides') and b.status in ('queued', 'deferred')
      -- A script (owner, 2026-11-09) has no video waiting on it: it goes only when the plan dropped its item.
      and b.item_id is null
      and not exists (select 1 from public.work_orders v where v.root_id = v_root.id and b.id = any(v.depends_on)
                      and v.status not in ('done', 'failed', 'cancelled'))
  loop
    perform public.work_order_move(v_item.id, 'cancelled', 'Its video was dropped from the new plan');
    for v_run in
      update public.cmo_runs set status = 'failed', error = 'Its video was dropped from the new plan.', finished_at = now(),
        lease_until = null
      where user_id = p_user and kind = v_item.kind and status = 'queued' and input->>'order_id' = v_item.id::text
      returning *
    loop
      perform public.cmo_refund_run(v_run);
    end loop;
  end loop;

  -- A script whose item the new plan dropped after it was written: its waiting card goes (a run under way raises
  -- none, `work_orders_brief_rules`).
  for v_item in
    select b.id from public.work_orders b
    where b.root_id = v_root.id and b.kind = 'write_video_brief' and b.item_id is null and b.status = 'done'
      and not exists (select 1 from public.work_orders v where v.root_id = v_root.id and b.id = any(v.depends_on)
                      and v.status not in ('done', 'failed', 'cancelled'))
  loop
    perform public.approval_close('work_order', v_item.id, 'cancelled');
  end loop;

  -- Niche video research (P5 R2): once a week, when the plan has a new video item. Its briefs wait on it, so Writer
  -- cites what works on video in the founder's niche; a research run that cannot start leaves them to go on alone.
  if exists (select 1 from public.content_items c
             where c.user_id = p_user and c.run_id = p_run and c.status = 'planned' and c.department = 'video'
               and c.platform <> 'Slideshow' and c.clip_id is null and not exists (select 1 from public.work_orders o where o.item_id = c.id))
     and not exists (select 1 from public.work_orders where root_id = v_root.id and kind = 'niche_video_research'
                     and status not in ('failed', 'cancelled'))
     -- Research from the last six days is still fresh: the briefs read it, nothing is paid twice.
     and not exists (select 1 from public.cmo_insights where user_id = p_user and kind = 'niche_video'
                     and created_at > now() - interval '6 days') then
    v_free := v_root.budget_credits - v_root.spent_credits - coalesce((
      select sum(budget_credits - spent_credits) from public.work_orders
      where parent_id = v_root.id and status not in ('done', 'failed', 'cancelled')), 0);
    v_price := public.cmo_job_price('niche_video_research');
    v_niche := public.work_order_create(p_user, v_week, v_root.id, 'niche_video_research', 'What works on video in your niche',
      jsonb_build_object('objective', 'Find what works on short video in the founder''s niche.',
        'done_when', 'The week''s video briefs can cite standout videos.'),
      least(v_price, greatest(v_free, 0)), null, '{}', 'loop');
    perform public.writer_order_start(v_niche, '{}'::jsonb);
  end if;
  select * into v_niche from public.work_orders where root_id = v_root.id and kind = 'niche_video_research'
    and status not in ('done', 'failed', 'cancelled') order by created_at desc limit 1;

  for v_item in
    select c.id, c.department, c.idea, c.reason, c.platform, c.day from public.content_items c
    where c.user_id = p_user and c.run_id = p_run and c.status = 'planned' and c.department in ('post', 'sales', 'video')
      and c.clip_id is null and not exists (select 1 from public.work_orders o where o.item_id = c.id)
    order by c.day, c.created_at
  loop
    v_free := v_root.budget_credits - v_root.spent_credits - coalesce((
      select sum(budget_credits - spent_credits) from public.work_orders
      where parent_id = v_root.id and status not in ('done', 'failed', 'cancelled')), 0);
    v_due := (v_item.day + interval '23 hours 59 minutes') at time zone 'UTC';
    -- A slideshow is the founder's own photos now (D7, 2026-11-12): an old plan's Slideshow item orders nothing.
    if v_item.department = 'video' and v_item.platform = 'Slideshow' then
      continue;
    end if;
    if v_item.department = 'video' then
      -- The founder makes the videos (owner, 2026-11-09): Writer writes the script and the storyboard, a script card
      -- asks the founder (`work_orders_brief_rules`), and nothing builds the video.
      v_price := public.cmo_job_price('write_video_brief');
      v_brief := public.work_order_create(p_user, v_week, v_root.id, 'write_video_brief',
        left('Script for “' || v_item.idea || '”', 200),
        jsonb_build_object('objective', v_item.idea, 'reason', coalesce(v_item.reason, ''), 'platform', v_item.platform,
          'done_when', 'The founder approved the script.'),
        least(v_price, greatest(v_free, 0)), v_due, case when v_niche.id is null then '{}'::uuid[] else array[v_niche.id] end,
        'loop', v_item.id);
      -- With research under way, the brief starts when it ends (`work_orders_brief_rules`).
      if v_niche.id is null then
        perform public.writer_order_start(v_brief, jsonb_build_object('idea', v_item.idea, 'reason', coalesce(v_item.reason, ''),
          'seconds', public.cmo_video_seconds(), 'aspect', '9:16', 'platform', v_item.platform));
      end if;
      continue;
    end if;
    v_price := public.cmo_job_price(case v_item.department when 'post' then 'post_draft' else 'sales_scan' end);
    -- Past the weekly budget the order is still planned, with nothing to spend: it shows as over budget.
    perform public.work_order_create(p_user, v_week, v_root.id,
      case v_item.department when 'post' then 'post_draft' else 'sales_scan' end, v_item.idea,
      jsonb_build_object('objective', v_item.idea, 'done_when',
        case v_item.department when 'post' then 'A draft waits on the founder''s card.' else 'Threads worth a reply wait on cards.' end),
      least(v_price, greatest(v_free, 0)), v_due, '{}', 'loop', v_item.id);
  end loop;

  -- The week on one card (cmo-review B2.1): a replan replaces this week's card, last week's goes. A resync after the
  -- founder dropped items from the card raises nothing.
  if coalesce(current_setting('opencmo.plan_resync', true), '') <> '1' then
    update public.approvals set status = 'cancelled', decided_at = now()
    where user_id = p_user and kind = 'plan' and status in ('waiting', 'held') and ref_id <> v_root.id;
    perform public.approval_raise(p_user, 'work_order', v_root.id);
  end if;

  if not exists (select 1 from public.work_orders where root_id = v_root.id and kind = 'review_week') then
    perform public.work_order_create(p_user, v_week, v_root.id, 'review_week', 'Sunday review',
      jsonb_build_object('objective', 'Measure the week against its goal and propose the next one.'),
      0, (v_week + 6)::timestamptz + interval '12 hours');
  end if;
  return v_root;
end;
$$;

do $$
declare
  v_order record;
  v_run public.cmo_runs;
begin
  for v_order in
    select o.id, o.user_id, o.depends_on from public.work_orders o
    where o.kind = 'build_slideshow' and o.status in ('queued', 'deferred') and o.run_id is null
  loop
    perform public.work_order_move(v_order.id, 'cancelled', 'Slideshows are your own photos now');
    for v_run in
      update public.cmo_runs r set status = 'failed', error = 'Slideshows are your own photos now.', finished_at = now(),
        lease_until = null
      where r.user_id = v_order.user_id and r.kind = 'write_slides' and r.status = 'queued'
        and r.input->>'order_id' = any (select d::text from unnest(v_order.depends_on) d)
      returning r.*
    loop
      perform public.cmo_refund_run(v_run);
    end loop;
    perform public.work_order_move(b.id, 'cancelled', 'Slideshows are your own photos now')
    from public.work_orders b
    where b.id = any (v_order.depends_on) and b.kind = 'write_slides' and b.status in ('queued', 'deferred');
  end loop;
end;
$$;
