-- cmo-review-3 2.1 (session A): a reason picked on every draft. Skip offers chips; an edited approve offers them once
-- as "What did you fix?". A chip that names an edit label is the founder's label: the classifier never overwrites it,
-- and two founder labels of a kind propose a rule (the model's labels still need three). Founder skips count too.

begin;

alter table public.cmo_draft_outcomes
  add column if not exists reason_code text,
  add column if not exists labelled_by text;
alter table public.cmo_draft_outcomes drop constraint if exists cmo_draft_outcomes_reason_code_check;
alter table public.cmo_draft_outcomes add constraint cmo_draft_outcomes_reason_code_check
  check (reason_code in ('TOO_SALESY', 'WRONG_VOICE', 'INVENTED_CLAIM', 'TOO_LONG', 'HOOK_REWRITTEN', 'OFF_TOPIC', 'OTHER'));
alter table public.cmo_draft_outcomes drop constraint if exists cmo_draft_outcomes_labelled_by_check;
alter table public.cmo_draft_outcomes add constraint cmo_draft_outcomes_labelled_by_check
  check (labelled_by in ('founder', 'model'));
-- Labels the classifier wrote before this column existed are the model's.
update public.cmo_draft_outcomes set labelled_by = 'model'
where labelled_by is null and edit_mode is not null and edit_mode <> 'NO_MEANINGFUL_EDIT';

-- The chips, as the card names them (`components/cards/labels.ts` holds the same list). Null for an unknown code.
CREATE OR REPLACE FUNCTION public.cmo_reason_label(p_code text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case p_code
    when 'TOO_SALESY' then 'Too salesy'
    when 'WRONG_VOICE' then 'Doesn''t sound like me'
    when 'INVENTED_CLAIM' then 'Made something up'
    when 'TOO_LONG' then 'Too long'
    when 'HOOK_REWRITTEN' then 'Weak first line'
    when 'OFF_TOPIC' then 'Off topic'
    when 'OTHER' then 'Something else' end
$$;

-- The founder's chip on a decided post: kept on its outcome. A chip that is an edit label becomes the outcome's label
-- (`labelled_by = 'founder'`, classified now), which runs the learning trigger at once; an approve as written has
-- nothing to label.
CREATE OR REPLACE FUNCTION public.cmo_label_outcome(p_user uuid, p_item uuid, p_code text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_mode text := case when p_code in ('TOO_SALESY', 'WRONG_VOICE', 'INVENTED_CLAIM', 'TOO_LONG', 'HOOK_REWRITTEN') then p_code end;
begin
  if p_code is null then
    return;
  end if;
  update public.cmo_draft_outcomes
  set reason_code = p_code,
      labelled_by = case when v_mode is not null then 'founder' else labelled_by end,
      edit_mode = coalesce(v_mode, edit_mode),
      classified_at = case when v_mode is not null then now() else classified_at end
  where user_id = p_user and item_id = p_item and department = 'post'
    and (action = 'skip' or edit_mode is distinct from 'NO_MEANINGFUL_EDIT');
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
  v_code text := nullif(v_payload->>'reason_code', '');
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
      -- The time and account the card shows change through the post's proposal, which raises the card again; the
      -- answer is the new card, so the founder approves what they now see (cmo-review-3 1.2).
      if p_action in ('change_time', 'change_account') then
        perform set_config('opencmo.decided_via', '', true);
        return public.post_change_proposal(v_row, p_action, v_payload);
      end if;
      if p_action not in ('approve', 'skip') then
        raise exception 'Choose approve or skip.' using errcode = '22023';
      end if;
      -- The founder's chip (cmo-review-3 2.1): checked here, kept on the decision's outcome. Without words of their
      -- own, the chip's name is the skip reason the planner and the voice note read.
      if v_code is not null and public.cmo_reason_label(v_code) is null then
        raise exception 'Pick one of the reasons on the card.' using errcode = '22023';
      end if;
      if p_action = 'skip' and v_reason is null and v_code is not null and v_code <> 'OTHER' then
        v_reason := public.cmo_reason_label(v_code);
      end if;
      perform public.cmo_decide_post(v_row.ref_id, p_action, v_payload->>'text', coalesce(v_payload->>'reason', v_reason));
      perform public.cmo_label_outcome(v_user, v_row.ref_id, v_code);
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
        -- The founder's own video: they change it in the editor and mark it finished again (a new order).
        for v_order in
          select id from public.work_orders where user_id = v_user and kind = 'post_video'
            and brief->>'clip_id' = v_row.ref_id::text and status not in ('done', 'failed', 'cancelled')
        loop
          perform public.work_order_move(v_order, 'cancelled', 'You sent the video back');
        end loop;
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


CREATE OR REPLACE FUNCTION public.correction_from_edits(p_outcome uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_o public.cmo_draft_outcomes;
  v_rule text;
  v_since timestamptz;
  v_n integer;
  v_founder integer;
  v_edits jsonb;
  v_id uuid;
begin
  select * into v_o from public.cmo_draft_outcomes where id = p_outcome;
  v_rule := public.correction_rule(v_o.edit_mode);
  -- An approve's label (the founder's or the model's), or a skip the founder labelled with a chip (cmo-review-3 2.1).
  if v_o.id is null or v_rule is null or v_o.department <> 'post'
     or not (v_o.action = 'approve' or (v_o.action = 'skip' and v_o.labelled_by = 'founder')) then
    return null;
  end if;
  -- The same lock as `cmo_propose_correction`: one proposal at a time per founder.
  perform pg_advisory_xact_lock(hashtextextended('cmo_corrections:' || v_o.user_id::text, 0));
  if exists (select 1 from public.cmo_corrections where user_id = v_o.user_id and edit_mode = v_o.edit_mode and status = 'proposed') then
    return null;
  end if;
  v_since := greatest(now() - interval '14 days', coalesce((
    select max(created_at) from public.cmo_corrections where user_id = v_o.user_id and edit_mode = v_o.edit_mode), '-infinity'));
  select count(*), count(*) filter (where labelled_by = 'founder') into v_n, v_founder from public.cmo_draft_outcomes
  where user_id = v_o.user_id and department = 'post' and edit_mode = v_o.edit_mode and decided_at > v_since
    and (action = 'approve' or (action = 'skip' and labelled_by = 'founder'));
  -- The founder said it twice; the model needs three to be sure.
  if v_founder < 2 and v_n < 3 then
    return null;
  end if;
  -- An approved rule with the same words already holds; five waiting rules are enough for one founder.
  if exists (select 1 from public.cmo_corrections where user_id = v_o.user_id and status = 'active' and lower(rule) = lower(v_rule))
     or (select count(*) from public.cmo_corrections where user_id = v_o.user_id and status = 'proposed') >= 5 then
    return null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('before', left(e.draft, 300), 'after', left(e.final_text, 300), 'at', e.at)
    order by e.decided_at desc, e.id), '[]'::jsonb)
  into v_edits
  from (
    select case o.chosen_version when 0 then c.body->>'text' else c.body->'alternates'->>(o.chosen_version - 1) end as draft,
      c.final_text, to_char(o.decided_at, 'YYYY-MM-DD') as at, o.decided_at, o.id
    from public.cmo_draft_outcomes o
    join public.content_items c on c.id = o.item_id and c.user_id = o.user_id
    where o.user_id = v_o.user_id and o.department = 'post' and o.action = 'approve' and o.edit_mode = v_o.edit_mode
      and o.decided_at > v_since and c.final_text is not null and o.chosen_version is not null
    order by o.decided_at desc, o.id
    limit 3
  ) e
  where e.draft is not null;
  insert into public.cmo_corrections (user_id, rule, source_edits, edit_mode, times)
  values (v_o.user_id, v_rule, v_edits, v_o.edit_mode, least(v_n, 100))
  returning id into v_id;
  return v_id;
end;
$$;


CREATE OR REPLACE FUNCTION public.cmo_set_edit_mode(p_id uuid, p_mode text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_mode is null or p_mode not in ('NO_MEANINGFUL_EDIT', 'TOO_SALESY', 'WRONG_VOICE', 'INVENTED_CLAIM',
                                      'TOO_LONG', 'HOOK_REWRITTEN', 'CTA_REMOVED', 'FULL_REWRITE') then
    raise exception 'Unknown edit mode.' using errcode = '22023';
  end if;
  -- A founder's label is never overwritten: it sets `classified_at`, and is checked here too.
  update public.cmo_draft_outcomes set edit_mode = p_mode, classified_at = now(), labelled_by = 'model'
  where id = p_id and classified_at is null and labelled_by is distinct from 'founder';
  return found;
end;
$$;


revoke all on function public.cmo_reason_label(text) from public, anon, authenticated;
revoke all on function public.cmo_label_outcome(uuid, uuid, text) from public, anon, authenticated;

commit;
