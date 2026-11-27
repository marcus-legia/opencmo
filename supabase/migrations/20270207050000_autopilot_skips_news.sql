-- Part B7 (plan docs/superpowers/plans/2026-11-27-content-plan-and-x-news.md): a post that opens from an X News story.
--
-- 1. `approval_snapshot_base` puts the story on the post card's snapshot (`news`: name, link, the picker's reason), so
--    the card shows "News: …" and approving the post approves that story too. A post without one keeps its old hash.
-- 2. Autopilot never approves such a post: the story's summary is written by a model from strangers' posts and can be
--    wrong, so the founder reads it first. Both halves of the rule change, `post_autopilot_at` (when a card is raised)
--    and `post_autopilot_still_on` (when its countdown ends), as in 20270123010000.
--
-- The three bodies are today's (`supabase/schema/current.sql`) with only the lines above added.

begin;

create or replace function public.approval_snapshot_base(p_ref_kind text, p_ref_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
        -- The founder's own photos are part of what they approve; a post without any keeps its old hash.
        || case when cardinality(photos) > 0 then jsonb_build_object('photos', to_jsonb(photos)) else '{}'::jsonb end
        -- The X News story the draft opens from (Part B7): shown on the card and part of what the founder approves. A
        -- post without one keeps its old hash.
        || case when jsonb_typeof(body->'news') = 'object' and coalesce(body->'news'->>'name', '') <> '' then
             jsonb_build_object('news', jsonb_build_object(
               'name', left(body->'news'->>'name', 120),
               'url', case when coalesce(body->'news'->>'url', '') ~ '^https://x\.com/i/status/[0-9]{1,19}$' then body->'news'->>'url' else '' end,
               'why', left(coalesce(body->'news'->>'why', ''), 200)))
           else '{}'::jsonb end
      into v from public.content_items where id = p_ref_id;
    when 'opportunity' then
      select jsonb_build_object('kind', 'reply', 'url', url, 'community', community, 'title', title,
        'reply', reply, 'score', score, 'score_parts', score_parts)
        || case when rule is not null then jsonb_build_object('rule', rule, 'rule_why', coalesce(rule_why, '')) else '{}'::jsonb end
      into v from public.opportunities where id = p_ref_id and (rule is distinct from 'skip');
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
        -- The slideshow as built (B3): its slides, the MP4 and the PNG set of this exact document. Any edit to the
        -- document changes `document_hash` and supersedes the card.
        when 'slideshow' then jsonb_build_object('kind', 'slideshow', 'step_id', s.id, 'clip_id', s.clip_id,
          'title', coalesce(s.card->>'title', ''), 'aspect', s.card->'aspect',
          'slides', case when jsonb_typeof(s.card->'slides') = 'array' then s.card->'slides' else '[]'::jsonb end,
          'document_hash', (select public.editor_document_hash(p.document) from public.editor_projects p where p.clip_id = s.clip_id),
          'mp4_path', s.card->'mp4_path', 'png_set_path', s.card->'png_set_path')
        else jsonb_build_object('kind', 'price', 'step_id', s.id, 'clip_id', s.clip_id, 'tool', s.tool,
          'title', coalesce(s.card->>'title', ''), 'what', coalesce(s.card->>'what', ''), 'seconds', s.card->'seconds',
          'wait_minutes', s.card->'wait_minutes',
          'keyframes', case when jsonb_typeof(s.card->'keyframes') = 'array' then s.card->'keyframes' else '[]'::jsonb end,
          'shots', coalesce(s.card->'shots', '0'::jsonb), 'price_credits', s.price_credits)
        end
      into v from public.studio_steps s where s.id = p_ref_id;
      if v->>'kind' = 'slideshow' then
        v_captions := public.caption_snapshots(array[(v->>'clip_id')::uuid]);
      end if;
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
    when 'schedule_slot' then
      -- Content, time, account and the platform's fields: everything the founder approves before it posts
      -- (approval.md rule 1). `content_hash` covers the words and the edit, so a change to either supersedes it.
      select jsonb_build_object('kind', 'schedule', 'slot_id', s.id, 'deliverable_id', s.deliverable_id,
        'deliverable_kind', d.kind, 'platform', s.platform, 'mode', s.mode, 'account_id', s.account_id,
        'handle', a.handle, 'publish_at', to_char(s.publish_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'options', s.options, 'last_error', s.error->>'message')
        || public.schedule_content(s.deliverable_id, s.platform)
      into v
      from public.schedule_slots s
      join public.deliverables d on d.id = s.deliverable_id
      left join public.social_accounts a on a.id = s.account_id
      where s.id = p_ref_id;
    else
      raise exception 'Unknown card source.' using errcode = '22023';
  end case;
  if v is not null and v_captions is not null then
    v := v || jsonb_build_object('captions', v_captions);
  end if;
  return v;
end;
$$;

create or replace function public.post_autopilot_at(p_user uuid, p_ref_kind text, p_ref_id uuid, p_snapshot jsonb) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_p jsonb := p_snapshot->'proposed';
  v_profile public.profiles;
  v_item public.content_items;
  v_at timestamptz;
  v_auto timestamptz;
begin
  if p_snapshot->>'kind' is distinct from 'post' or p_ref_kind <> 'content_item' or p_snapshot ? 'thread'
     or v_p is null or v_p->>'mode' is distinct from 'publish' then
    return null;
  end if;
  select * into v_profile from public.profiles where id = p_user;
  if not found or v_profile.cmo_paused_at is not null or v_profile.autopilot_paused
     or v_profile.plan not in ('starter', 'creator')
     or not (v_p->>'platform' = any (v_profile.autopilot_platforms)) then
    return null;
  end if;
  select * into v_item from public.content_items where id = p_ref_id and user_id = p_user and department = 'post';
  -- A brief the founder wrote in the chat is theirs to read before it goes out. So is a post that opens from X News
  -- (Part B7): the story's summary is written by a model and can be wrong.
  if not found or v_item.status <> 'in_review' or v_item.body->>'source' = 'cmo_chat'
     or (jsonb_typeof(v_item.body->'news') = 'object' and coalesce(v_item.body->'news'->>'name', '') <> '') then
    return null;
  end if;
  if not exists (select 1 from public.social_accounts a
                 where a.user_id = p_user and a.platform = v_p->>'platform' and a.status = 'connected'
                   and a.id::text = v_p->>'account_id') then
    return null;
  end if;
  begin
    v_at := (v_p->>'at')::timestamptz;
  exception when others then
    return null;
  end;
  -- Approved a quarter of an hour before its time at the latest, so the slot is waiting when the sweep looks.
  v_auto := least(now() + make_interval(hours => v_profile.autopilot_hours), v_at - interval '15 minutes');
  if v_auto < now() + public.autopilot_min_window() then
    return null;
  end if;
  return v_auto;
end;
$$;

create or replace function public.post_autopilot_still_on(p_card public.approvals) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p_card.kind = 'post' and p_card.ref_kind = 'content_item' and not (p_card.snapshot ? 'thread')
    and p_card.snapshot->'proposed'->>'mode' = 'publish'
    and exists (select 1 from public.profiles p
                where p.id = p_card.user_id and p.cmo_paused_at is null and not p.autopilot_paused
                  and p.plan in ('starter', 'creator')
                  and p_card.snapshot->'proposed'->>'platform' = any (p.autopilot_platforms))
    and exists (select 1 from public.content_items c
                where c.id = p_card.ref_id and c.user_id = p_card.user_id and c.status = 'in_review'
                  and c.body->>'source' is distinct from 'cmo_chat'
                  -- The same test as the card's: a story with a headline (`approval_snapshot_base`).
                  and not (jsonb_typeof(c.body->'news') = 'object' and coalesce(c.body->'news'->>'name', '') <> ''))
    and exists (select 1 from public.social_accounts a
                where a.user_id = p_card.user_id and a.status = 'connected'
                  and a.platform = p_card.snapshot->'proposed'->>'platform'
                  and a.id::text = p_card.snapshot->'proposed'->>'account_id');
$$;

commit;
