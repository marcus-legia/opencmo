-- The founder makes the videos (owner, 2026-11-09; plan 2026-11-09 C1). A week plan's video item is a script: Writer
-- writes the brief with a storyboard (`write_video_brief`), a free script card asks the founder, and nothing builds the
-- video. The founder approves (or edits a beat), then records it in the editor. No week plan orders `build_video`.

begin;


-- The beat a script card's edit names, and its words: one check for both kinds of script card.
create or replace function public.approval_script_beat(p_beats jsonb, p_payload jsonb, out beat integer, out words text)
language plpgsql immutable
set search_path to 'public'
as $$
begin
  if jsonb_typeof(p_payload->'beat') is distinct from 'number'
     or (p_payload->>'beat')::numeric <> trunc((p_payload->>'beat')::numeric) then
    raise exception 'Say which beat to change.' using errcode = '22023';
  end if;
  beat := (p_payload->>'beat')::numeric::integer;
  words := trim(coalesce(p_payload->>'text', ''));
  if beat < 0 or beat >= coalesce(jsonb_array_length(p_beats), 0) then
    raise exception 'That beat is not in the script.' using errcode = '22023';
  end if;
  if char_length(words) not between 1 and 300 then
    raise exception 'A beat''s words are 1 to 300 characters.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.approval_script_beat(jsonb, jsonb) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION public.work_orders_plan_week(p_user uuid, p_run uuid) RETURNS public.work_orders
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
    -- A slideshow (cmo-review B2.3): Writer writes the slides, then the Slideshow squad builds them
    -- (`work_orders_brief_rules` copies the slides into the order; `studio_orders_claim` starts it when they are done).
    if v_item.department = 'video' and v_item.platform = 'Slideshow' then
      v_price := public.cmo_job_price('write_slides');
      v_brief := public.work_order_create(p_user, v_week, v_root.id, 'write_slides',
        left('Slides for “' || v_item.idea || '”', 200),
        jsonb_build_object('objective', v_item.idea, 'reason', coalesce(v_item.reason, ''),
          'done_when', 'Studio has the slides for this slideshow.'),
        least(v_price, greatest(v_free, 0)), v_due, '{}', 'loop');
      perform public.work_order_create(p_user, v_week, v_root.id, 'build_slideshow', v_item.idea,
        jsonb_build_object('idea', v_item.idea, 'aspect', '9:16', 'platform', 'TikTok',
          'done_when', 'The founder approved the slideshow.'),
        0, v_due, array[v_brief.id], 'loop', v_item.id);
      perform public.writer_order_start(v_brief, jsonb_build_object('idea', v_item.idea, 'reason', coalesce(v_item.reason, '')));
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

CREATE OR REPLACE FUNCTION public.work_orders_brief_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_brief jsonb;
  v_sources jsonb;
  v_video public.work_orders;
begin
  if new.kind not in ('write_video_brief', 'write_slides', 'niche_video_research') or new.status = old.status or new.status not in ('done', 'failed', 'cancelled') then
    return new;
  end if;
  -- Niche research ended, however it ended: the video briefs waiting on it start now (P5 R2), with the plan's input.
  if new.kind = 'niche_video_research' then
    for v_video in
      select * from public.work_orders where user_id = new.user_id and new.id = any(depends_on) and status = 'queued'
        and kind = 'write_video_brief' for update
    loop
      update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now()
      where id = v_video.id returning * into v_video;
      perform public.writer_order_start(v_video, jsonb_build_object('idea', v_video.brief->>'objective',
        'reason', coalesce(v_video.brief->>'reason', ''), 'seconds', public.cmo_video_seconds(), 'aspect', '9:16', 'platform', v_video.brief->>'platform'));
    end loop;
    return new;
  end if;
  -- A script (owner, 2026-11-09): no video waits on this brief. Its storyboard goes on the order and a script card asks
  -- the founder; they record the video themselves.
  if new.kind = 'write_video_brief'
     and not exists (select 1 from public.work_orders where user_id = new.user_id and new.id = any(depends_on)
                     and status not in ('done', 'failed', 'cancelled')) then
    if new.status = 'done' then
      begin
        select r.output->'brief', r.output->'sources' into v_brief, v_sources from public.cmo_runs r where r.id = new.run_id;
        if jsonb_typeof(v_sources) is distinct from 'array' or jsonb_array_length(v_sources) > 6 or octet_length(v_sources::text) > 4096 then
          v_sources := null;
        end if;
        if jsonb_typeof(v_brief->'storyboard') = 'array' and jsonb_array_length(v_brief->'storyboard') between 3 and 8
           and octet_length((v_brief->'storyboard')::text) <= 16384
           and char_length(coalesce(v_brief->>'objective', '')) between 3 and 300 then
          update public.work_orders
          set brief = brief || jsonb_strip_nulls(jsonb_build_object('objective', v_brief->'objective', 'angle', v_brief->'angle',
                'hooks', v_brief->'hooks', 'cta', v_brief->'cta', 'seconds', v_brief->'seconds', 'aspect', v_brief->'aspect',
                'storyboard', v_brief->'storyboard', 'sources', v_sources, 'brief_from', 'writer')),
              updated_at = now()
          where id = new.id;
          -- The plan dropped its item while it was being written: no card for a video the founder removed.
          if new.item_id is not null then
            perform public.approval_raise(new.user_id, 'work_order', new.id);
            update public.content_items set status = 'in_review', updated_at = now()
            where id = new.item_id and status in ('planned', 'drafting');
          end if;
        else
          perform public.work_order_event(new, 'note', 'Writer could not write the script for “' || new.title || '”');
        end if;
      exception when others then
        raise warning 'script rule for order % failed: %', new.id, sqlerrm;
      end;
    end if;
    return new;
  end if;
  -- Writer's slides (P5 S3) go into the slideshow order waiting on them, as the video brief goes into its video.
  if new.kind = 'write_slides' then
    begin
      if new.status = 'done' then
        select r.output into v_brief from public.cmo_runs r where r.id = new.run_id;
        if jsonb_typeof(v_brief->'slides') is distinct from 'array' or jsonb_array_length(v_brief->'slides') not between 1 and 20
           or octet_length((v_brief->'slides')::text) > 16384 then
          v_brief := null;
        end if;
      end if;
      for v_video in
        select * from public.work_orders where user_id = new.user_id and new.id = any(depends_on) and status = 'queued'
          and kind = 'build_slideshow' for update
      loop
        if v_brief is not null then
          update public.work_orders
          set brief = (brief - array['slides', 'slides_reason'])
                || jsonb_strip_nulls(jsonb_build_object('slides', v_brief->'slides', 'slides_reason', v_brief->>'reason',
                     'brief_from', 'writer')),
              updated_at = now()
          where id = v_video.id;
          perform public.work_order_event(v_video, 'note', 'Writer wrote the slides for “' || v_video.title || '”');
        else
          update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now() where id = v_video.id;
          perform public.work_order_event(v_video, 'note', '“' || v_video.title || '” goes on without Writer''s slides');
        end if;
      end loop;
    exception when others then
      raise warning 'slides rule for order % failed: %', new.id, sqlerrm;
      update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now()
      where user_id = new.user_id and new.id = any(depends_on) and status = 'queued';
    end;
    return new;
  end if;
  begin
    if new.status = 'done' then
      select r.output->'brief', r.output->'sources' into v_brief, v_sources from public.cmo_runs r where r.id = new.run_id;
      -- The niche videos the brief learned from (P5 F8): links only, the job keeps only those its research read.
      if jsonb_typeof(v_sources) is distinct from 'array' or jsonb_array_length(v_sources) > 6
         or octet_length(v_sources::text) > 4096 then
        v_sources := null;
      end if;
      if jsonb_typeof(v_brief) is distinct from 'object' or char_length(coalesce(v_brief->>'objective', '')) not between 3 and 300 then
        v_brief := null;
      end if;
    end if;
    for v_video in
      select * from public.work_orders where user_id = new.user_id and new.id = any(depends_on) and status = 'queued' for update
    loop
      if v_brief is not null then
        update public.work_orders
        set brief = (brief - array['objective', 'angle', 'hooks', 'key_points', 'cta', 'seconds', 'aspect', 'sources'])
              || jsonb_strip_nulls(jsonb_build_object('objective', v_brief->'objective', 'angle', v_brief->'angle',
                   'hooks', v_brief->'hooks', 'key_points', coalesce(v_brief->'keyPoints', v_brief->'key_points'),
                   'cta', v_brief->'cta', 'seconds', v_brief->'seconds', 'aspect', v_brief->'aspect', 'brief_from', 'writer',
                   'sources', v_sources)),
            updated_at = now()
        where id = v_video.id;
        perform public.work_order_event(v_video, 'note', 'Writer wrote the brief for “' || v_video.title || '”');
      else
        update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now() where id = v_video.id;
        perform public.work_order_event(v_video, 'note', '“' || v_video.title || '” goes on with the plan''s own brief');
      end if;
    end loop;
  exception when others then
    -- The brief could not be taken (too long for the order, say): the video still goes on, with its own brief.
    raise warning 'brief rule for order % failed: %', new.id, sqlerrm;
    update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now()
    where user_id = new.user_id and new.id = any(depends_on) and status = 'queued';
  end;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.approval_snapshot(p_ref_kind text, p_ref_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v jsonb;
  v_look public.look_checks;
  v_extra jsonb;
begin
  -- The week plan card (cmo-review B2.1): the week's calendar as the brain planned it. Status stays out, so drafting a
  -- post does not change the card the founder is reading; an item they drop leaves it.
  if p_ref_kind = 'work_order' then
    -- A script the founder records (owner, 2026-11-09): the card of the `script` kind, free, read from the brief.
    select case when o.kind = 'write_video_brief' then jsonb_build_object('kind', 'script', 'step_id', o.id, 'clip_id', '',
        'tool', 'script_item', 'title', left(coalesce(o.brief->>'objective', o.title), 200),
        'seconds', o.brief->'seconds', 'aspect', o.brief->'aspect', 'price_credits', 0,
        'beats', coalesce((select jsonb_agg(jsonb_build_object('words', left(b->>'say', 300),
            'picture', left(case b->>'shot' when 'talking_head' then 'To camera: ' when 'screen' then 'Screen: ' else 'You film: ' end
              || coalesce(b->>'show', ''), 300), 'motion', null) order by n)
          from jsonb_array_elements(o.brief->'storyboard') with ordinality as s(b, n)), '[]'::jsonb)) end
    into v from public.work_orders o where o.id = p_ref_id;
    if v is not null then
      return v;
    end if;
    return public.plan_snapshot(p_ref_id);
  end if;
  v := public.approval_snapshot_base(p_ref_kind, p_ref_id);
  if v is null then
    return v;
  end if;
  if p_ref_kind = 'content_item' then
    select case when public.thread_valid(body) then jsonb_build_object('thread', body->'thread') end into v_extra
    from public.content_items where id = p_ref_id;
    return v || coalesce(v_extra, '{}'::jsonb);
  end if;
  if p_ref_kind = 'opportunity' then
    select case when platform <> 'reddit' then jsonb_build_object('platform', platform) end into v_extra
    from public.opportunities where id = p_ref_id;
    return v || coalesce(v_extra, '{}'::jsonb);
  end if;
  if p_ref_kind not in ('editor_project', 'short_batch', 'studio_step') then
    return v;
  end if;
  select * into v_look from public.look_checks c
  where c.ref_kind = p_ref_kind and c.ref_id = p_ref_id and c.status = 'failed'
    and c.doc_key = coalesce(v->>'document_hash', v->>'parent_hash')
  order by c.round desc, c.created_at desc limit 1;
  if found and coalesce(v_look.result->>'note', '') <> '' then
    v := v || jsonb_build_object('look', jsonb_build_object('pass', false, 'round', v_look.round,
      'note', left(v_look.result->>'note', 200)));
  end if;
  return v;
end;
$$;

CREATE OR REPLACE FUNCTION public.approval_decide(p_id uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS public.approvals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := public.require_user();
  v_row public.approvals;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_via text := coalesce(nullif(v_payload->>'via', ''), 'app');
  v_target integer;
  v_step public.studio_steps;
  v_batch public.short_batches;
  v_order uuid;
  v_n integer;
  v_text text;
  v_reason text := left(nullif(trim(coalesce(v_payload->>'reason', '')), ''), 400);
  v_caption public.content_items;
  v_title text;
  v_slot public.schedule_slots;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'The decision is malformed.' using errcode = '22023';
  end if;
  if v_via not in ('app', 'mcp') then
    raise exception 'Cards are decided in the app or through MCP.' using errcode = '22023';
  end if;
  select * into v_row from public.approvals where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'waiting' then
    raise exception 'This card was already decided.' using errcode = 'P0001';
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'This card expired. A new one will ask again.' using errcode = 'P0001';
  end if;
  if v_payload->>'content_hash' is distinct from v_row.content_hash
     or public.approval_hash(public.approval_snapshot(v_row.ref_kind, v_row.ref_id)) is distinct from v_row.content_hash then
    raise exception 'This card changed. Look at it again before deciding.' using errcode = 'P0001';
  end if;

  -- Words on a finished video or a shorts batch: one caption changes, nothing is decided.
  if p_action = 'edit_caption' then
    if v_row.kind not in ('finished_video', 'shorts_batch', 'slideshow') then
      raise exception 'Only a video''s, a batch''s or a slideshow''s captions are edited here.' using errcode = '22023';
    end if;
    if coalesce(v_payload->>'caption', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Say which caption to change.' using errcode = '22023';
    end if;
    select * into v_caption from public.content_items
    where id = (v_payload->>'caption')::uuid and user_id = v_user and department = 'video' and clip_id is not null
      and v_row.snapshot->'captions' @> jsonb_build_array(jsonb_build_object('caption_id', (v_payload->>'caption')))
    for update;
    if not found then
      raise exception 'That caption is not on this card.' using errcode = '22023';
    end if;
    v_text := trim(coalesce(v_payload->>'text', ''));
    v_title := case when v_caption.platform = 'youtube' then nullif(trim(coalesce(v_payload->>'title', v_caption.body->>'title', '')), '') end;
    perform public.caption_check(v_caption.platform, v_text, v_title);
    update public.content_items
    set body = jsonb_strip_nulls(body || jsonb_build_object('text', v_text, 'title', v_title, 'edited_at', now())),
        updated_at = now()
    where id = v_caption.id;
    perform public.approval_refresh(v_row.ref_kind, v_row.ref_id);
    select * into v_row from public.approvals where id = p_id;
    return v_row;
  end if;

  perform set_config('opencmo.decided_via', v_via, true);
  -- The week plan card (cmo-review B2.1) has its own function: it drops items and closes, nothing else runs.
  if v_row.kind = 'plan' then
    perform public.plan_card_decide(v_row, p_action, v_payload);
    perform set_config('opencmo.decided_via', '', true);
    select * into v_row from public.approvals where id = p_id;
    if v_reason is not null and v_row.status = 'skipped' then
      update public.approvals set reason = v_reason where id = p_id returning * into v_row;
    end if;
    return v_row;
  end if;
  case v_row.kind
    when 'post' then
      if p_action not in ('approve', 'skip') then
        raise exception 'Choose approve or skip.' using errcode = '22023';
      end if;
      perform public.cmo_decide_post(v_row.ref_id, p_action, v_payload->>'text', v_payload->>'reason');
    when 'reply' then
      if p_action not in ('replied', 'dismissed') then
        raise exception 'Choose replied or dismissed.' using errcode = '22023';
      end if;
      perform public.cmo_decide_opportunity(v_row.ref_id, p_action, v_payload->>'reason', v_payload->>'text');
    when 'goal' then
      if p_action not in ('approve', 'reject') then
        raise exception 'Choose approve or reject.' using errcode = '22023';
      end if;
      if v_payload ? 'target' then
        if jsonb_typeof(v_payload->'target') <> 'number'
           or (v_payload->>'target')::numeric <> trunc((v_payload->>'target')::numeric) then
          raise exception 'The target must be a whole number.' using errcode = '22023';
        end if;
        v_target := (v_payload->>'target')::numeric::integer;
      end if;
      perform public.cmo_decide_goal(v_row.ref_id, p_action, v_payload->>'goal', v_target);
    when 'correction' then
      perform public.cmo_decide_correction(v_row.ref_id, p_action, v_payload->>'text');
    when 'script', 'price' then
      if v_row.ref_kind = 'work_order' then
        if p_action not in ('approve', 'edit', 'cancel') then
          raise exception 'Choose approve, edit a beat or cancel.' using errcode = '22023';
        end if;
        if p_action = 'edit' then
          select b.beat, b.words into v_n, v_text from public.approval_script_beat(v_row.snapshot->'beats', v_payload) b;
          -- The founder's words are the script they record: kept on the order, the card closes as edited.
          update public.work_orders set brief = jsonb_set(brief, array['storyboard', v_n::text, 'say'], to_jsonb(v_text)),
            updated_at = now()
          where id = v_row.ref_id and user_id = v_user;
          perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'edited');
        else
          perform public.approval_close(v_row.ref_kind, v_row.ref_id, case p_action when 'cancel' then 'skipped' else 'approved' end);
        end if;
        -- The calendar item: approved, the founder records it; cancelled, it is skipped.
        update public.content_items c set status = case p_action when 'cancel' then 'skipped' else 'approved' end,
          decided_at = now(), updated_at = now()
        from public.work_orders o
        where o.id = v_row.ref_id and c.id = o.item_id and c.user_id = v_user and c.status in ('planned', 'drafting', 'in_review');
      else
      if (v_row.kind = 'script' and p_action not in ('approve', 'edit', 'cancel'))
         or (v_row.kind = 'price' and p_action not in ('approve', 'redo', 'cancel')) then
        raise exception '%', case v_row.kind when 'script' then 'Choose approve, edit a beat or cancel.'
          else 'Choose approve, redo a keyframe or cancel.' end using errcode = '22023';
      end if;
      select * into v_step from public.studio_steps where id = v_row.ref_id and user_id = v_user and kind in ('script', 'price') for update;
      if not found or v_step.status <> 'waiting' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'edit' then
        select b.beat, b.words into v_n, v_text from public.approval_script_beat(v_row.snapshot->'beats', v_payload) b;
        -- The order runner plans the storyboard again with these words (`next`, added in 20261228120000): queued
        -- like any other Studio step, so it waits while the founder's CMO is paused and is retried.
        update public.studio_steps set status = 'cancelled', decision = 'edit', decided_at = now(),
          decision_payload = jsonb_build_object('beat', v_n, 'text', v_text),
          next = '{"tool": "replan"}'::jsonb, next_done_at = null
        where id = v_step.id;
      elsif p_action = 'redo' then
        if jsonb_typeof(v_payload->'index') is distinct from 'number'
           or (v_payload->>'index')::numeric <> trunc((v_payload->>'index')::numeric) then
          raise exception 'Say which keyframe to make again.' using errcode = '22023';
        end if;
        v_n := (v_payload->>'index')::numeric::integer;
        if not exists (select 1 from jsonb_array_elements(v_row.snapshot->'keyframes') k
                       where jsonb_typeof(k->'index') = 'number' and (k->>'index')::numeric = v_n) then
          raise exception 'That keyframe is not on the sheet.' using errcode = '22023';
        end if;
        update public.studio_steps set status = 'approved', decision = 'redo', decided_at = now(),
          decision_payload = jsonb_build_object('index', v_n)
        where id = v_step.id;
      elsif p_action = 'cancel' then
        update public.studio_steps set status = 'cancelled', decision = 'cancel', decided_at = now() where id = v_step.id;
        if v_step.order_id is not null and exists (select 1 from public.work_orders
            where id = v_step.order_id and status not in ('done', 'failed', 'cancelled')) then
          perform public.work_order_move(v_step.order_id, 'cancelled', 'You cancelled the video');
        end if;
      else
        update public.studio_steps set status = 'approved', decision = 'approve', decided_at = now() where id = v_step.id;
      end if;
      end if;
    when 'finished_video' then
      if p_action not in ('approve', 'send_back') then
        raise exception 'Choose approve or send back.' using errcode = '22023';
      end if;
      if p_action = 'approve' then
        -- Closes the card and finishes a video order making this edit (mark_finished owns both).
        perform public.mark_finished(v_row.ref_id, v_row.snapshot->>'document_hash');
      else
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'skipped');
        -- A failure is data: the order fails with the founder's reason and the progress check replans it.
        select s.order_id into v_order from public.studio_steps s join public.work_orders o on o.id = s.order_id
        where s.clip_id = v_row.ref_id and o.kind = 'build_video' and o.status not in ('done', 'failed', 'cancelled')
        order by s.created_at desc limit 1;
        if v_order is not null then
          perform public.work_order_move(v_order, 'failed', null, jsonb_build_object('code', 'sent_back',
            'message', coalesce(v_reason, 'The founder sent the video back.'), 'retryable', true,
            'repair_hint', 'Change what the founder asked, then render the video again.'));
        end if;
      end if;
    when 'shorts_batch' then
      if p_action not in ('approve', 'send_back') then
        raise exception 'Choose approve or send back.' using errcode = '22023';
      end if;
      select * into v_batch from public.short_batches where id = v_row.ref_id and user_id = v_user for update;
      if not found or v_batch.status <> 'waiting_founder' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'approve' then
        update public.short_batches set status = 'approved', decided_at = now() where id = v_batch.id;
        update public.shorts set status = 'approved' where batch_id = v_batch.id and status = 'ready';
        -- Each short is its own deliverable, ready for Schedule (P4).
        if v_batch.order_id is not null then
          insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
          select v_user, v_batch.order_id, 'short', 'clip', s.short_clip_id, 'ready'
          from public.shorts s where s.batch_id = v_batch.id and s.status = 'approved' and s.short_clip_id is not null
          on conflict (ref_kind, ref_id) do nothing;
          if exists (select 1 from public.work_orders where id = v_batch.order_id and status not in ('done', 'failed', 'cancelled')) then
            perform public.work_order_move(v_batch.order_id, 'done', 'Shorts approved');
          end if;
        end if;
        perform public.approval_close('short_batch', v_batch.id, 'approved');
      else
        update public.short_batches set status = 'sent_back', decided_at = now() where id = v_batch.id;
        update public.shorts set status = 'sent_back' where batch_id = v_batch.id and status = 'ready';
        -- A failure is data: the replan reads the reason and may not cut the same shorts again (brain.md §6).
        if v_batch.order_id is not null and exists (select 1 from public.work_orders
            where id = v_batch.order_id and status not in ('done', 'failed', 'cancelled')) then
          perform public.work_order_move(v_batch.order_id, 'failed', null, jsonb_build_object('code', 'sent_back',
            'message', coalesce(v_reason, 'The founder sent the shorts back.'), 'retryable', true,
            'repair_hint', 'Cut different ranges from the same finished edit.'));
        end if;
        perform public.approval_close('short_batch', v_batch.id, 'skipped');
      end if;
    when 'slideshow' then
      -- Rendered before the card was raised, so approving runs nothing: the step and its order finish here and the
      -- MP4 becomes the slideshow deliverable Schedule picks up (A3). Text edits happen in the Slides view, which
      -- changes the document and raises a new card.
      if p_action not in ('approve', 'send_back') then
        raise exception 'Choose approve or send back.' using errcode = '22023';
      end if;
      select * into v_step from public.studio_steps where id = v_row.ref_id and user_id = v_user and kind = 'slideshow' for update;
      if not found or v_step.status <> 'waiting' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'approve' then
        update public.studio_steps set status = 'done', decision = 'approve', decided_at = now() where id = v_step.id;
        if v_step.order_id is not null then
          insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
          values (v_user, v_step.order_id, 'slideshow', 'clip', v_step.clip_id, 'ready')
          on conflict (ref_kind, ref_id) do nothing;
          if exists (select 1 from public.work_orders where id = v_step.order_id and status not in ('done', 'failed', 'cancelled')) then
            perform public.work_order_move(v_step.order_id, 'done', 'Slideshow approved');
          end if;
        end if;
      else
        update public.studio_steps set status = 'cancelled', decision = 'cancel', decided_at = now() where id = v_step.id;
        -- A failure is data: the order fails with the founder's reason and the progress check replans it.
        if v_step.order_id is not null and exists (select 1 from public.work_orders
            where id = v_step.order_id and status not in ('done', 'failed', 'cancelled')) then
          perform public.work_order_move(v_step.order_id, 'failed', null, jsonb_build_object('code', 'sent_back',
            'message', coalesce(v_reason, 'The founder sent the slideshow back.'), 'retryable', true,
            'repair_hint', 'Change what the founder asked, then build the slideshow again.'));
        end if;
      end if;
    when 'schedule' then
      -- Time, account and platform fields change through schedule_change, which raises the card again; the
      -- answer is the new card, so the founder looks at what they now approve.
      if p_action in ('change_time', 'change_account', 'set_options') then
        perform set_config('opencmo.decided_via', '', true);
        return public.schedule_change(v_row.ref_id, p_action, v_payload);
      end if;
      if p_action not in ('approve', 'retry', 'cancel') then
        raise exception 'Choose approve, change the time or account, or cancel.' using errcode = '22023';
      end if;
      select * into v_slot from public.schedule_slots where id = v_row.ref_id and user_id = v_user for update;
      if not found or v_slot.status not in ('proposed', 'failed') then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'cancel' then
        update public.schedule_slots set status = 'cancelled', updated_at = now() where id = v_slot.id;
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'skipped');
      elsif v_slot.status = 'failed' and now() >= v_slot.window_ends_at then
        -- Too late for this time: never post late. The founder's Retry asks for a new time instead.
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'approved');
        perform public.schedule_propose(v_slot.deliverable_id);
      else
        if p_action = 'retry' and v_slot.status <> 'failed' then
          raise exception 'There is nothing to retry.' using errcode = '22023';
        end if;
        perform public.schedule_ready_check(v_slot);
        begin
          update public.schedule_slots set status = 'waiting', updated_at = now() where id = v_slot.id;
        exception when unique_violation then
          raise exception 'This post already has another time on %.', public.schedule_platform_label(v_slot.platform)
            using errcode = 'P0001';
        end;
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'approved');
      end if;
    else
      raise exception 'This card cannot be decided yet.' using errcode = 'P0001';
  end case;
  perform set_config('opencmo.decided_via', '', true);

  select * into v_row from public.approvals where id = p_id;
  if v_reason is not null and v_row.status in ('skipped', 'edited') then
    update public.approvals set reason = v_reason where id = p_id returning * into v_row;
  end if;
  return v_row;
end;
$_$;


-- "Open in editor" on an approved script: one blank edit per script, kept on the order, so a second click opens the same
-- edit. The web route then sets one marker per beat (editor-core `set_marker`) when the edit has none.
create or replace function public.cmo_script_open(p_order uuid) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_order public.work_orders;
  v_clip uuid;
begin
  select * into v_order from public.work_orders
  where id = p_order and user_id = v_user and kind = 'write_video_brief' for update;
  if not found or jsonb_typeof(v_order.brief->'storyboard') is distinct from 'array' then
    raise exception 'Script not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.approvals where user_id = v_user and ref_kind = 'work_order' and ref_id = v_order.id
                 and kind = 'script' and status in ('approved', 'edited')) then
    raise exception 'Approve the script first.' using errcode = 'P0001';
  end if;
  if v_order.brief->>'clip_id' is not null then
    select c.id into v_clip from public.clips c join public.jobs j on j.id = c.job_id
    where c.id::text = v_order.brief->>'clip_id' and j.user_id = v_user and j.purging_at is null;
    if v_clip is not null then
      return v_clip;
    end if;
  end if;
  v_clip := public.create_blank_edit(left(coalesce(v_order.brief->>'objective', v_order.title), 60),
    case when v_order.brief->>'aspect' in ('9:16', '1:1', '16:9') then v_order.brief->>'aspect' else '9:16' end);
  update public.work_orders set brief = brief || jsonb_build_object('clip_id', v_clip), updated_at = now() where id = v_order.id;
  return v_clip;
end;
$$;
revoke all on function public.cmo_script_open(uuid) from public, anon;
grant execute on function public.cmo_script_open(uuid) to authenticated;

commit;
