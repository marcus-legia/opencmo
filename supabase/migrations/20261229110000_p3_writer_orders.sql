-- 20261229110000: P3 A2, Writer's orders and the rules that start them (plan F7, F8, F9; sessions/A.md A2).
--
-- Three Writer jobs run as CMO runs (so OpenCMO, the founder's Claude or the fake thinks for them, and a failed run
-- is refunded): `write_video_brief`, `write_caption`, `write_slides` (registered; S3 in P5 orders it). Rules, all in
-- SQL so they hold whoever moved the row:
--
-- - A video item of the week plan becomes a `write_video_brief` order and a `build_video` order that waits on it
--   (`depends_on`). When the brief is written, Studio's order takes it (objective, angle, three hooks, key points, call
--   to action, length, frame); when it fails or is cancelled, the video goes on with the plan's own brief.
-- - A finished-video card (card 3) or a shorts batch card raised → one `write_caption` order for the edits on it, per
--   platform the week's plan targets (all three caption profiles when it names none). Writer saves each caption with
--   `cmo_save_caption`; the card shows it under a new hash, keeping its id. The founder edits a caption on the card
--   (`approval_decide` action `edit_caption`); the founder's words are never overwritten by Writer.
-- - Approving the video or the batch makes each caption a deliverable under its video's or short's deliverable.
--
-- A run carries its order (`input.order_id`), so Writer orders of one kind each get their own run (`cmo_enqueue`
-- dedupes them, and post drafts with an item, per order or item instead of per kind). The schedule drafts every post
-- due today, one run per item. `cmo_save_draft` takes the post's platform (Session B's request).

begin;

-- ------------------------------------------------------------------ kinds, prices, limits

alter table public.cmo_runs drop constraint cmo_runs_kind_check;
alter table public.cmo_runs add constraint cmo_runs_kind_check check (kind in ('onboard', 'plan_week', 'post_draft', 'sales_scan',
  'competitor_research', 'pull_metrics', 'summarize_memory', 'review_week', 'write_caption', 'write_video_brief', 'write_slides'));

create or replace function public.cmo_job_price(p_kind text) returns integer
language sql immutable
as $$
  select case p_kind when 'plan_week' then 1 when 'post_draft' then 1 when 'sales_scan' then 5
    when 'competitor_research' then 2 when 'pull_metrics' then 0 when 'summarize_memory' then 0 when 'review_week' then 0
    when 'write_caption' then 1 when 'write_video_brief' then 1 when 'write_slides' then 1
    else 0 end
$$;

create or replace function public.cmo_job_daily_limit(p_kind text) returns integer
language sql immutable
as $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'write_video_brief' then 5 when 'write_slides' then 10
    else 0 end
$$;

create or replace function public.work_order_department(p_kind text) returns text
language sql immutable set search_path = public
as $$
  select case p_kind
    when 'post_draft' then 'writer' when 'sales_scan' then 'sales'
    when 'competitor_research' then 'research' when 'pull_metrics' then 'research' when 'review_week' then 'research'
    when 'build_video' then 'studio' when 'cut_shorts' then 'studio'
    when 'write_caption' then 'writer' when 'write_video_brief' then 'writer' when 'write_slides' then 'writer'
    else 'brain' end
$$;
revoke all on function public.work_order_department(text) from public, anon, authenticated;

-- Same as 20261227120000, except a run that names its calendar item (a post draft) or its order (Writer's orders)
-- waits only behind a run for the same item or order: a founder's three posts due today, or two Writer orders,
-- each get a run. The item comes first: the schedule names a post's order only while the order is queued, so a
-- post's runs must match by item whether they carry the order or not.
create or replace function public.cmo_enqueue(p_user uuid, p_kind text, p_input jsonb) returns public.cmo_runs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.cmo_runs;
  v_price integer := case
    when p_input->>'brain' = 'claude' and public.is_paid(p_user) then 0
    else public.cmo_job_price(p_kind)
  end;
  v_key text := case when p_kind in ('post_draft', 'write_caption', 'write_video_brief', 'write_slides')
    then coalesce(p_input->>'item_id', p_input->>'order_id') end;
begin
  if p_kind is null or p_kind = 'onboard' or public.cmo_job_daily_limit(p_kind) <= 0 then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 4096 then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  -- Replays are started by inbox_submit only, for an item the founder owns.
  if p_input ? 'inbox' then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  if public.cmo_paused(p_user) then
    raise exception 'Your CMO is paused. Resume it to start new work.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':cmo_run', 1713));

  select * into v_row from public.cmo_runs
  where user_id = p_user and kind = p_kind and status in ('queued', 'running')
    and (status = 'queued' or lease_until is null or lease_until > now())
    and (v_key is null or coalesce(input->>'item_id', input->>'order_id') = v_key)
  order by created_at desc limit 1;
  if found then
    return v_row;
  end if;

  if (select count(*) from public.cmo_runs
      where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day'
        and not (input ? 'inbox')) >= public.cmo_job_daily_limit(p_kind) then
    raise exception 'You have reached today''s limit for this task. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if v_price > 0 and public.credit_balance(p_user) < v_price then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_price, public.credit_balance(p_user) using errcode = 'P0001';
  end if;

  insert into public.cmo_runs (user_id, kind, status, input, credits)
  values (p_user, p_kind, 'queued', p_input, v_price) returning * into v_row;
  if v_price > 0 then
    perform public.credit_hold(p_user, 'cmo_run', v_row.id, v_price, 'CMO hold');
  end if;
  return v_row;
end;
$$;

-- Starts the run of a Writer order the rules just made. A run that cannot start (paused, no credits, the daily cap)
-- fails the order with the reason, so whatever waits on it goes on without it.
create or replace function public.writer_order_start(p_order public.work_orders, p_input jsonb) returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  begin
    perform public.cmo_enqueue(p_order.user_id, p_order.kind, p_input || jsonb_build_object('order_id', p_order.id, 'source', 'event'));
  exception when others then
    perform public.work_order_move(p_order.id, 'failed', null, jsonb_build_object('code', 'not_started',
      'message', left(sqlerrm, 200), 'retryable', true));
  end;
end;
$$;
revoke all on function public.writer_order_start(public.work_orders, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ the video brief before the video

-- Same as 20261228120000, plus Writer's brief: a new video item becomes a `write_video_brief` order and a
-- `build_video` order that waits on it. A replan replaces every calendar item, so a video the new plan still has
-- takes over its order (and brief) before anything is cancelled: a video waits `queued` on its brief, and cancelling
-- it first would pay for a second brief. Only videos left without an item are cancelled, with a brief that has not
-- started and that only they waited on; that brief's queued run is failed and refunded, so it never runs.
create or replace function public.work_orders_plan_week(p_user uuid, p_run uuid)
returns public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_week date := date_trunc('week', current_date)::date;
  v_root public.work_orders;
  v_item record;
  v_free integer;
  v_price integer;
  v_brief public.work_orders;
  v_due timestamptz;
  v_run public.cmo_runs;
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
      and c.clip_id is null and not exists (select 1 from public.work_orders o where o.item_id = c.id)
    order by c.day, c.created_at
  loop
    update public.work_orders set item_id = v_item.id, updated_at = now()
    where id = (select id from public.work_orders where root_id = v_root.id and kind = 'build_video' and item_id is null
                  and status not in ('done', 'failed', 'cancelled') order by created_at limit 1);
  end loop;
  -- Videos the new plan dropped that have not started.
  for v_item in
    select id from public.work_orders where root_id = v_root.id and item_id is null and run_id is null
      and kind = 'build_video' and status = 'queued' and created_by = 'loop'
  loop
    perform public.work_order_move(v_item.id, 'cancelled', 'Dropped from the new plan');
  end loop;
  -- A brief not started yet whose every video was dropped, and its run, which would still run and charge.
  for v_item in
    select b.id from public.work_orders b
    where b.root_id = v_root.id and b.kind = 'write_video_brief' and b.status in ('queued', 'deferred')
      and not exists (select 1 from public.work_orders v where v.root_id = v_root.id and b.id = any(v.depends_on)
                      and v.status not in ('done', 'failed', 'cancelled'))
  loop
    perform public.work_order_move(v_item.id, 'cancelled', 'Its video was dropped from the new plan');
    for v_run in
      update public.cmo_runs set status = 'failed', error = 'Its video was dropped from the new plan.', finished_at = now(),
        lease_until = null
      where user_id = p_user and kind = 'write_video_brief' and status = 'queued' and input->>'order_id' = v_item.id::text
      returning *
    loop
      perform public.cmo_refund_run(v_run);
    end loop;
  end loop;

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
    if v_item.department = 'video' then
      -- Videos that took over an order were matched above and have their order now; this one is new.
      v_price := public.cmo_job_price('write_video_brief');
      v_brief := public.work_order_create(p_user, v_week, v_root.id, 'write_video_brief',
        left('Brief for “' || v_item.idea || '”', 200),
        jsonb_build_object('objective', v_item.idea, 'reason', coalesce(v_item.reason, ''), 'platform', v_item.platform,
          'done_when', 'Studio has the brief for this video.'),
        least(v_price, greatest(v_free, 0)), v_due, '{}', 'loop');
      perform public.work_order_create(p_user, v_week, v_root.id, 'build_video', v_item.idea,
        jsonb_build_object('objective', v_item.idea, 'angle', coalesce(v_item.reason, ''), 'seconds', 30, 'aspect', '9:16',
          'platform', v_item.platform, 'done_when', 'The founder approved the finished video.'),
        least(public.studio_video_budget(), greatest(v_free - least(v_price, greatest(v_free, 0)), 0)), v_due,
        array[v_brief.id], 'loop', v_item.id);
      perform public.writer_order_start(v_brief, jsonb_build_object('idea', v_item.idea, 'reason', coalesce(v_item.reason, ''),
        'seconds', 30, 'aspect', '9:16', 'platform', v_item.platform));
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

  if not exists (select 1 from public.work_orders where root_id = v_root.id and kind = 'review_week') then
    perform public.work_order_create(p_user, v_week, v_root.id, 'review_week', 'Sunday review',
      jsonb_build_object('objective', 'Measure the week against its goal and propose the next one.'),
      0, (v_week + 6)::timestamptz + interval '12 hours');
  end if;
  return v_root;
end;
$$;
revoke all on function public.work_orders_plan_week(uuid, uuid) from public, anon, authenticated;

-- Same as 20261228120000, except an order that waits on another (a video on its brief) is not claimed yet.
create or replace function public.studio_orders_claim(p_order uuid default null, p_limit integer default 3)
returns setof public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  for v_id in
    select o.id from public.work_orders o
    where o.status = 'queued' and o.kind in ('build_video', 'cut_shorts') and (p_order is null or o.id = p_order)
      and not public.cmo_paused(o.user_id)
      and not exists (select 1 from unnest(o.depends_on) d(id) left join public.work_orders w on w.id = d.id
                      where w.status is distinct from 'done')
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 3), 10))
    for update skip locked
  loop
    return next public.work_order_move(v_id, 'running');
  end loop;
end;
$$;
revoke all on function public.studio_orders_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.studio_orders_claim(uuid, integer) to service_role;

-- Same as 20261228120000, with the same wait.
create or replace function public.studio_work_count() returns integer
language sql stable security definer set search_path = public
as $$
  select (
    (select count(*) from public.work_orders o where o.status = 'queued' and o.kind in ('build_video', 'cut_shorts')
       and not public.cmo_paused(o.user_id)
       and not exists (select 1 from unnest(o.depends_on) d(id) left join public.work_orders w on w.id = d.id
                       where w.status is distinct from 'done'))
    + (select count(*) from public.studio_steps s join public.work_orders o on o.id = s.order_id
       where s.status = 'approved' and o.status not in ('done', 'failed', 'cancelled') and not public.cmo_paused(s.user_id)
         and (s.claimed_at is null or s.claimed_at < now() - interval '10 minutes'))
    + (select count(*) from public.studio_steps s join public.work_orders o on o.id = s.order_id
       where s.next is not null and s.next_done_at is null and o.status not in ('done', 'failed', 'cancelled')
         and not public.cmo_paused(s.user_id)
         and not exists (select 1 from unnest(s.wait_for) w(id) join public.generations g on g.id = w.id
                         where g.status in ('queued', 'running')))
  )::integer
$$;
revoke all on function public.studio_work_count() from public, anon, authenticated;
grant execute on function public.studio_work_count() to service_role;

-- A brief written: the videos waiting on it take it (the run's `output.brief`, Writer's `VideoBrief`). A brief that
-- failed, was cancelled or came back empty: they stop waiting and go on with the plan's own brief.
create or replace function public.work_orders_brief_rules() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_brief jsonb;
  v_video public.work_orders;
begin
  if new.kind <> 'write_video_brief' or new.status = old.status or new.status not in ('done', 'failed', 'cancelled') then
    return new;
  end if;
  begin
    if new.status = 'done' then
      select r.output->'brief' into v_brief from public.cmo_runs r where r.id = new.run_id;
      if jsonb_typeof(v_brief) is distinct from 'object' or char_length(coalesce(v_brief->>'objective', '')) not between 3 and 300 then
        v_brief := null;
      end if;
    end if;
    for v_video in
      select * from public.work_orders where user_id = new.user_id and new.id = any(depends_on) and status = 'queued' for update
    loop
      if v_brief is not null then
        update public.work_orders
        set brief = (brief - array['objective', 'angle', 'hooks', 'key_points', 'cta', 'seconds', 'aspect'])
              || jsonb_strip_nulls(jsonb_build_object('objective', v_brief->'objective', 'angle', v_brief->'angle',
                   'hooks', v_brief->'hooks', 'key_points', coalesce(v_brief->'keyPoints', v_brief->'key_points'),
                   'cta', v_brief->'cta', 'seconds', v_brief->'seconds', 'aspect', v_brief->'aspect', 'brief_from', 'writer')),
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
revoke all on function public.work_orders_brief_rules() from public, anon, authenticated;
create trigger work_orders_brief_rules after update of status on public.work_orders
  for each row execute function public.work_orders_brief_rules();

-- ------------------------------------------------------------------ captions

-- One caption per edit and profile.
create unique index content_items_caption_key on public.content_items (clip_id, platform) where clip_id is not null;

-- The caption profiles in `platforms.json` order; a card lists captions in it.
create or replace function public.caption_profiles() returns text[] language sql immutable
as $$ select array['instagram_caption', 'tiktok_caption', 'youtube'] $$;
revoke all on function public.caption_profiles() from public, anon, authenticated;

-- What a card shows of the captions of these edits (`CaptionSnapshotSchema`); null when there are none, so a card
-- raised before captions existed keeps its hash.
create or replace function public.caption_snapshots(p_clips uuid[]) returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_agg(jsonb_build_object('caption_id', c.id, 'clip_id', c.clip_id, 'profile', c.platform,
      'text', coalesce(c.body->>'text', ''), 'title', c.body->>'title')
    order by array_position(p_clips, c.clip_id), array_position(public.caption_profiles(), c.platform))
  from public.content_items c
  where c.clip_id = any(p_clips) and c.department = 'video'
$$;
revoke all on function public.caption_snapshots(uuid[]) from public, anon, authenticated;

-- Same as 20261229100000, plus the captions on the finished-video and shorts cards.
create or replace function public.approval_snapshot(p_ref_kind text, p_ref_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v jsonb;
  v_captions jsonb;
begin
  case p_ref_kind
    when 'content_item' then
      select jsonb_build_object('kind', 'post', 'platform', platform, 'day', day, 'idea', idea,
        'text', coalesce(body->>'text', ''),
        'alternates', case when jsonb_typeof(body->'alternates') = 'array' then body->'alternates' else '[]'::jsonb end,
        'rationale', coalesce(body->>'rationale', reason))
      into v from public.content_items where id = p_ref_id;
    when 'opportunity' then
      select jsonb_build_object('kind', 'reply', 'url', url, 'community', community, 'title', title,
        'reply', reply, 'score', score, 'score_parts', score_parts)
      into v from public.opportunities where id = p_ref_id;
    when 'goal' then
      select jsonb_build_object('kind', 'goal', 'week', week, 'goal', goal, 'metric', metric, 'target', target)
      into v from public.cmo_goals where id = p_ref_id;
    when 'correction' then
      select jsonb_build_object('kind', 'correction', 'rule', rule, 'source_edits', source_edits)
        || case when edit_mode is not null then jsonb_build_object('edit_mode', edit_mode, 'times', times) else '{}'::jsonb end
      into v from public.cmo_corrections where id = p_ref_id;
    when 'studio_step' then
      select case s.kind
        when 'script' then jsonb_build_object('kind', 'script', 'step_id', s.id, 'clip_id', s.clip_id, 'tool', s.tool,
          'title', coalesce(s.card->>'title', ''), 'seconds', s.card->'seconds', 'aspect', s.card->'aspect',
          'beats', case when jsonb_typeof(s.card->'beats') = 'array' then s.card->'beats' else '[]'::jsonb end,
          'price_credits', s.price_credits)
        else jsonb_build_object('kind', 'price', 'step_id', s.id, 'clip_id', s.clip_id, 'tool', s.tool,
          'title', coalesce(s.card->>'title', ''), 'what', coalesce(s.card->>'what', ''), 'seconds', s.card->'seconds',
          'wait_minutes', s.card->'wait_minutes',
          'keyframes', case when jsonb_typeof(s.card->'keyframes') = 'array' then s.card->'keyframes' else '[]'::jsonb end,
          'shots', coalesce(s.card->'shots', '0'::jsonb), 'price_credits', s.price_credits)
        end
      into v from public.studio_steps s where s.id = p_ref_id;
    when 'editor_project' then
      select jsonb_build_object('kind', 'finished_video', 'clip_id', c.id, 'title', coalesce(c.hook, ''),
        'document_hash', public.editor_document_hash(p.document),
        'render_task_id', r.id, 'render_path', r.output_path, 'seconds', r.duration)
      into v
      from public.editor_projects p
      join public.clips c on c.id = p.clip_id
      left join lateral (
        select t.id, t.output_path, t.duration from public.tasks t
        where t.clip_id = p.clip_id and t.kind = 'render_document' and t.status = 'done'
          and t.settings_hash = public.editor_document_hash(p.document)
        order by t.finished_at desc nulls last, t.created_at desc
        limit 1
      ) r on true
      where p.clip_id = p_ref_id;
      v_captions := public.caption_snapshots(array[p_ref_id]);
    when 'short_batch' then
      select jsonb_build_object('kind', 'shorts_batch', 'batch_id', b.id, 'parent_clip_id', b.parent_clip_id,
        'title', coalesce(c.hook, ''), 'parent_hash', b.parent_hash,
        'shorts', coalesce((
          select jsonb_agg(jsonb_build_object('short_id', s.id, 'short_clip_id', s.short_clip_id,
            'start', s.source_start, 'end', s.source_end, 'hook', s.hook, 'reason', s.reason)
            order by s.source_start, s.id)
          from public.shorts s where s.batch_id = b.id and s.status <> 'failed'), '[]'::jsonb))
      into v
      from public.short_batches b
      left join public.clips c on c.id = b.parent_clip_id
      where b.id = p_ref_id;
      v_captions := public.caption_snapshots(array(
        select s.short_clip_id from public.shorts s
        where s.batch_id = p_ref_id and s.status <> 'failed' and s.short_clip_id is not null
        order by s.source_start, s.id));
    else
      raise exception 'Unknown card source.' using errcode = '22023';
  end case;
  if v is not null and v_captions is not null then
    v := v || jsonb_build_object('captions', v_captions);
  end if;
  return v;
end;
$$;
revoke all on function public.approval_snapshot(text, uuid) from public, anon, authenticated;

-- The waiting card of a row shows the row as it is now, under its new hash, keeping its id: a screen showing the old
-- words is refused (`approval_decide` checks the hash), and the founder's open card is the same card.
create or replace function public.approval_refresh(p_ref_kind text, p_ref_id uuid) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_snapshot jsonb := public.approval_snapshot(p_ref_kind, p_ref_id);
begin
  if v_snapshot is null then
    return;
  end if;
  update public.approvals set snapshot = v_snapshot, content_hash = public.approval_hash(v_snapshot)
  where ref_kind = p_ref_kind and ref_id = p_ref_id and status = 'waiting'
    and content_hash is distinct from public.approval_hash(v_snapshot);
end;
$$;
revoke all on function public.approval_refresh(text, uuid) from public, anon, authenticated;

-- The rules a caption keeps on its profile: its length, a title only on YouTube, no links, at most the profile's
-- hashtags. The same words for Writer and the founder.
create or replace function public.caption_check(p_profile text, p_text text, p_title text) returns void
language plpgsql immutable set search_path = public
as $$
declare
  v_profile jsonb := public.platform_profile(p_profile);
  v_label text := v_profile->>'label';
  v_tags integer;
begin
  if v_profile is null or v_profile->>'kind' not in ('caption', 'youtube') then
    raise exception 'Captions are for Instagram, TikTok and YouTube.' using errcode = '22023';
  end if;
  if p_text is null or char_length(trim(p_text)) = 0 or char_length(p_text) > (v_profile->>'limit')::integer then
    raise exception 'A % is 1 to % characters.', v_label, to_char((v_profile->>'limit')::integer, 'FM999,999') using errcode = '22023';
  end if;
  if v_profile->>'kind' = 'youtube' then
    if p_title is null or char_length(trim(p_title)) = 0 or char_length(p_title) > (v_profile->>'title')::integer then
      raise exception 'A YouTube title is 1 to % characters.', v_profile->>'title' using errcode = '22023';
    end if;
  elsif p_title is not null then
    raise exception 'Only YouTube has a title.' using errcode = '22023';
  end if;
  if concat_ws(' ', p_title, p_text) ~* '(https?://|www\.)' then
    raise exception 'Captions carry no links.' using errcode = '22023';
  end if;
  -- `countHashtags` in lib/cmo/platforms.ts: `#word` with a letter in it, not `#1` or `a#b`.
  select count(*) into v_tags
  from regexp_matches(concat_ws(' ', p_title, p_text), '(^|[^[:alnum:]_&/])#[[:alnum:]_]*[[:alpha:]][[:alnum:]_]*', 'g');
  if v_tags > (v_profile->>'hashtags')::integer then
    raise exception 'A % carries at most % hashtags.', v_label, v_profile->>'hashtags' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.caption_check(text, text, text) from public, anon, authenticated;

-- The cards that show this edit's captions catch up with them.
create or replace function public.caption_cards_refresh(p_clip uuid) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_batch uuid;
begin
  perform public.approval_refresh('editor_project', p_clip);
  for v_batch in select distinct s.batch_id from public.shorts s where s.short_clip_id = p_clip loop
    perform public.approval_refresh('short_batch', v_batch);
  end loop;
end;
$$;
revoke all on function public.caption_cards_refresh(uuid) from public, anon, authenticated;

-- A caption that belongs to a deliverable (its video or short was approved) is a deliverable too.
create or replace function public.caption_deliver(p_caption public.content_items) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_parent public.deliverables;
begin
  select * into v_parent from public.deliverables
  where ref_kind = 'clip' and ref_id = p_caption.clip_id and kind in ('video', 'short') and user_id = p_caption.user_id
  order by created_at limit 1;
  if not found then
    return;
  end if;
  insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status, parent_id)
  values (p_caption.user_id, v_parent.order_id, 'caption', 'content_item', p_caption.id, 'ready', v_parent.id)
  on conflict (ref_kind, ref_id) do nothing;
  update public.content_items set status = 'approved', decided_at = coalesce(decided_at, now()), updated_at = now()
  where id = p_caption.id and status = 'in_review';
end;
$$;
revoke all on function public.caption_deliver(public.content_items) from public, anon, authenticated;

-- Writer saves one caption (service role, the `write_caption` run). A caption the founder edited, or one already
-- approved or delivered, keeps its words: Writer only rewrites a caption still waiting on its card. Saving never
-- delivers: a caption becomes a deliverable only when the founder approves the card that shows it
-- (`deliverables_caption_rules`), so one written after the card was decided waits unseen instead of shipping.
-- Answers the caption row.
create or replace function public.cmo_save_caption(p_user uuid, p_run uuid, p_clip uuid, p_profile text, p_text text,
  p_title text default null, p_gen jsonb default '{}'::jsonb)
returns public.content_items language plpgsql volatile security definer set search_path = public
as $$
declare
  v_hook text;
  v_text text := trim(coalesce(p_text, ''));
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_row public.content_items;
begin
  select c.hook into v_hook from public.clips c join public.jobs j on j.id = c.job_id where c.id = p_clip and j.user_id = p_user;
  if not found then
    raise exception 'Video not found.' using errcode = 'P0002';
  end if;
  perform public.caption_check(p_profile, v_text, v_title);
  if p_gen is not null and (jsonb_typeof(p_gen) <> 'object' or octet_length(p_gen::text) > 1024) then
    raise exception 'This caption is not valid.' using errcode = '22023';
  end if;
  select * into v_row from public.content_items where clip_id = p_clip and platform = p_profile for update;
  if found and (v_row.body ? 'edited_at' or v_row.status <> 'in_review') then
    return v_row;
  end if;
  insert into public.content_items (user_id, run_id, department, platform, day, idea, status, body, clip_id)
  values (p_user, p_run, 'video', p_profile, current_date, left(coalesce(v_title, nullif(v_hook, ''), 'Caption'), 300), 'in_review',
    jsonb_strip_nulls(jsonb_build_object('text', v_text, 'title', v_title, 'drafted_text', v_text, 'drafted_title', v_title,
      'gen', coalesce(p_gen, '{}'::jsonb))),
    p_clip)
  on conflict (clip_id, platform) where clip_id is not null do update
  set body = excluded.body, idea = excluded.idea, run_id = excluded.run_id, updated_at = now()
  returning * into v_row;
  perform public.caption_cards_refresh(p_clip);
  return v_row;
end;
$$;
revoke all on function public.cmo_save_caption(uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cmo_save_caption(uuid, uuid, uuid, text, text, text, jsonb) to service_role;

-- Approving the video or the batch: its captions become deliverables under it.
create or replace function public.deliverables_caption_rules() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_caption public.content_items;
begin
  if new.ref_kind <> 'clip' or new.kind not in ('video', 'short') then
    return new;
  end if;
  for v_caption in select * from public.content_items where clip_id = new.ref_id and department = 'video' and user_id = new.user_id loop
    perform public.caption_deliver(v_caption);
  end loop;
  return new;
end;
$$;
revoke all on function public.deliverables_caption_rules() from public, anon, authenticated;
create trigger deliverables_caption_rules after insert on public.deliverables
  for each row execute function public.deliverables_caption_rules();

-- The caption profiles this week's plan targets (its video items' platforms), all three when it names none.
create or replace function public.caption_targets(p_user uuid) returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select array_agg(p order by array_position(public.caption_profiles(), p))
     from (select distinct public.platform_profile_id(c.platform) as p from public.content_items c
           where c.user_id = p_user and c.department = 'video' and c.clip_id is null
             and c.day between date_trunc('week', current_date)::date and date_trunc('week', current_date)::date + 6) x
     where p = any(public.caption_profiles())),
    public.caption_profiles())
$$;
revoke all on function public.caption_targets(uuid) from public, anon, authenticated;

-- A finished-video card or a shorts batch card raised: one `write_caption` order for its edits. A fault here never
-- stops the card.
create or replace function public.approvals_caption_rules() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_clips uuid[];
  v_root public.work_orders;
  v_order public.work_orders;
  v_free integer;
  v_profiles text[];
  -- The cut the captions describe: a finished video's document (sent back, edited and raised again, it is a new
  -- cut that needs new words; raised again for its render alone, it is not); a shorts batch is its own cut.
  v_cut text := case when new.kind = 'finished_video' then new.snapshot->>'document_hash' end;
begin
  if new.kind not in ('finished_video', 'shorts_batch') or new.status <> 'waiting' then
    return new;
  end if;
  begin
    if exists (select 1 from public.work_orders where user_id = new.user_id and kind = 'write_caption'
               and brief->>'ref_id' = new.ref_id::text and brief->>'document_hash' is not distinct from v_cut
               and status not in ('failed', 'cancelled'))
       or public.cmo_paused(new.user_id) then
      return new;
    end if;
    v_clips := case new.kind
      when 'finished_video' then array[new.ref_id]
      else array(select s.short_clip_id from public.shorts s where s.batch_id = new.ref_id and s.status = 'ready'
                   and s.short_clip_id is not null order by s.source_start, s.id) end;
    if cardinality(v_clips) = 0 then
      return new;
    end if;
    v_profiles := public.caption_targets(new.user_id);
    v_root := public.work_order_week_root(new.user_id);
    v_free := v_root.budget_credits - v_root.spent_credits - coalesce((
      select sum(budget_credits - spent_credits) from public.work_orders
      where parent_id = v_root.id and status not in ('done', 'failed', 'cancelled')), 0);
    v_order := public.work_order_create(new.user_id, v_root.week, v_root.id, 'write_caption',
      left('Captions for “' || coalesce(nullif(new.snapshot->>'title', ''), 'your video') || '”', 200),
      jsonb_build_object('objective', 'Write the captions for each platform.', 'ref_kind', new.ref_kind, 'ref_id', new.ref_id,
        'clip_ids', to_jsonb(v_clips), 'profiles', to_jsonb(v_profiles), 'done_when', 'The captions are on the card.')
        || case when v_cut is not null then jsonb_build_object('document_hash', v_cut) else '{}'::jsonb end,
      least(public.cmo_job_price('write_caption'), greatest(v_free, 0)), null, '{}', 'event');
    perform public.writer_order_start(v_order, jsonb_build_object('clip_ids', to_jsonb(v_clips), 'profiles', to_jsonb(v_profiles),
      'ref_kind', new.ref_kind, 'ref_id', new.ref_id));
  exception when others then
    raise warning 'caption rule for card % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.approvals_caption_rules() from public, anon, authenticated;
create trigger approvals_caption_rules after insert on public.approvals
  for each row execute function public.approvals_caption_rules();

-- Same as 20261228110000, plus `edit_caption` on the finished-video and shorts cards: the founder changes one caption
-- before approving; the card keeps its id and waits under a new hash.
create or replace function public.approval_decide(p_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns public.approvals language plpgsql volatile security definer set search_path = public
as $$
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
    if v_row.kind not in ('finished_video', 'shorts_batch') then
      raise exception 'Only a video''s or a batch''s captions are edited here.' using errcode = '22023';
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
      perform public.cmo_decide_opportunity(v_row.ref_id, p_action, v_payload->>'reason');
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
      if (v_row.kind = 'script' and p_action not in ('approve', 'edit', 'cancel'))
         or (v_row.kind = 'price' and p_action not in ('approve', 'redo', 'cancel')) then
        raise exception '%', case v_row.kind when 'script' then 'Choose approve, edit a beat or cancel.'
          else 'Choose approve, redo a keyframe or cancel.' end using errcode = '22023';
      end if;
      select * into v_step from public.studio_steps where id = v_row.ref_id and user_id = v_user for update;
      if not found or v_step.status <> 'waiting' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'edit' then
        if jsonb_typeof(v_payload->'beat') is distinct from 'number'
           or (v_payload->>'beat')::numeric <> trunc((v_payload->>'beat')::numeric) then
          raise exception 'Say which beat to change.' using errcode = '22023';
        end if;
        v_n := (v_payload->>'beat')::numeric::integer;
        v_text := trim(coalesce(v_payload->>'text', ''));
        if v_n < 0 or v_n >= jsonb_array_length(v_row.snapshot->'beats') then
          raise exception 'That beat is not in the script.' using errcode = '22023';
        end if;
        if char_length(v_text) not between 1 and 300 then
          raise exception 'A beat''s words are 1 to 300 characters.' using errcode = '22023';
        end if;
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
$$;
revoke all on function public.approval_decide(uuid, text, jsonb) from public, anon;
grant execute on function public.approval_decide(uuid, text, jsonb) to authenticated;

-- ------------------------------------------------------------------ a post draft for a platform (Session B's request)

-- Same as 20261014090000, plus `p_platform` for a draft with no calendar item ("write this for LinkedIn now"): a post
-- profile's label, X when absent or not a post platform.
drop function public.cmo_save_draft(uuid, uuid, uuid, text, jsonb, text);
create function public.cmo_save_draft(p_user uuid, p_run uuid, p_item uuid, p_idea text, p_body jsonb,
  p_priority text default 'medium', p_platform text default null)
returns public.content_items language plpgsql security definer set search_path = public
as $$
declare
  v_row public.content_items;
  v_profile jsonb := public.platform_profile(public.platform_profile_id(p_platform));
  v_post boolean := coalesce(v_profile->>'kind' = 'post', false);
  v_platform text := case when v_post then v_profile->>'label' else 'x' end;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' or coalesce(p_body->>'text', '') = '' then
    raise exception 'This draft is not valid.' using errcode = '22023';
  end if;
  if p_item is not null then
    update public.content_items
    set status = 'in_review', body = p_body, priority = coalesce(p_priority, 'medium'), run_id = p_run, updated_at = now()
    where id = p_item and user_id = p_user and status in ('planned', 'drafting')
    returning * into v_row;
    if not found then
      raise exception 'This calendar item is no longer open.' using errcode = 'P0002';
    end if;
  else
    insert into public.content_items (user_id, run_id, department, platform, day, idea, status, priority, body)
    values (p_user, p_run, 'post', v_platform, current_date,
            left(coalesce(nullif(p_idea, ''), 'Post for ' || case when v_post then v_profile->>'label' else 'X' end), 300),
            'in_review', coalesce(p_priority, 'medium'), p_body)
    returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke all on function public.cmo_save_draft(uuid, uuid, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.cmo_save_draft(uuid, uuid, uuid, text, jsonb, text, text) to service_role;

commit;
