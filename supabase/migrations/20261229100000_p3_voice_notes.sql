-- 20261229100000: P3 A1, voice notes and corrections from repeated edits (plan F5, F6; sessions/A.md A1).
--
-- Voice notes (writer.md §6): every decision on a post teaches something about how the founder writes. A post approved
-- as written, a post edited before approval (once the classifier named the edit) and a post skipped with a reason
-- each become one note (`cmo_memories`, topic `post`, kind `preference`, `source_outcome` = the decision). The note is
-- built here from the founder's own rows (the text they approved, the reason they typed), never from model output or
-- outside text. Notes expire after 60 days and weigh less as they age, so a new style replaces an old one in weeks;
-- the founder can delete any note, and a deleted note never comes back.
--
-- Corrections (brain.md §8, tier 0): the same edit three times in 14 days raises one `correction` card ("End on the
-- point itself: no closing ask"). Approved, it is a rule every draft reads first. One card per edit at a time.
--
-- Also: posts on Threads and LinkedIn are decided against their own limit and daily cap, and a calendar label ("X",
-- "LinkedIn") resolves to its profile everywhere (`platform_profile_id`), which fixes outcomes A0 left without a
-- platform and post cards the label hid.

begin;

-- ------------------------------------------------------------------ labels → profiles

-- The profile id a calendar label or a profile id names; null for Reddit and anything unknown. TypeScript keeps the
-- same map (`PLATFORM_LABELS` in apps/web/lib/cmo/platforms.ts); check:contracts compares them.
create or replace function public.platform_profile_id(p_label text) returns text
language sql immutable set search_path = public
as $$
  select case lower(trim(coalesce(p_label, '')))
    when 'x' then 'x'
    when 'twitter' then 'x'
    when 'threads' then 'threads'
    when 'linkedin' then 'linkedin'
    when 'instagram' then 'instagram_caption'
    when 'instagram_caption' then 'instagram_caption'
    when 'reels' then 'instagram_caption'
    when 'tiktok' then 'tiktok_caption'
    when 'tiktok_caption' then 'tiktok_caption'
    when 'youtube' then 'youtube'
    when 'shorts' then 'youtube'
    when 'youtube shorts' then 'youtube'
    else null end
$$;
revoke all on function public.platform_profile_id(text) from public, anon, authenticated;

-- Same as 20261229090000, reading the label the plan writes ("X", "LinkedIn"), not only a profile id.
create or replace function public.cmo_draft_outcomes_platform() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.platform is null and new.department = 'post' then
    select public.platform_profile_id(c.platform) into new.platform from public.content_items c where c.id = new.item_id;
  end if;
  return new;
end;
$$;
revoke all on function public.cmo_draft_outcomes_platform() from public, anon, authenticated;

-- Outcomes A0's backfill and trigger left empty (every post planned with the label "X"). A function so the test can
-- seed an old row and rerun it.
create or replace function public.cmo_draft_outcomes_backfill_platform() returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_n integer;
begin
  update public.cmo_draft_outcomes o set platform = public.platform_profile_id(c.platform)
  from public.content_items c
  where o.platform is null and o.department = 'post' and c.id = o.item_id and public.platform_profile_id(c.platform) is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cmo_draft_outcomes_backfill_platform() from public, anon, authenticated;
select public.cmo_draft_outcomes_backfill_platform();

-- ------------------------------------------------------------------ voice notes

-- The founder deleted the note this decision taught: it is never written again.
alter table public.cmo_draft_outcomes add column voice_note_deleted_at timestamptz;

-- What each edit mode says the founder did, in the note's words (EDIT_MODES in lib/cmo/jobs/edit-taxonomy.ts).
create or replace function public.voice_edit_phrase(p_mode text) returns text
language sql immutable set search_path = public
as $$
  select case p_mode
    when 'TOO_SALESY' then 'toned down the selling'
    when 'WRONG_VOICE' then 'rewrote it in their own voice'
    when 'INVENTED_CLAIM' then 'removed a claim that was not true'
    when 'TOO_LONG' then 'cut it shorter'
    when 'HOOK_REWRITTEN' then 'rewrote the first line'
    when 'CTA_REMOVED' then 'removed the closing ask'
    when 'FULL_REWRITE' then 'rewrote it'
    else null end
$$;
revoke all on function public.voice_edit_phrase(text) from public, anon, authenticated;

-- How long a voice note is read, and how many a founder keeps (the oldest goes first).
create or replace function public.voice_note_days() returns integer language sql immutable as $$ select 60 $$;
create or replace function public.voice_note_cap() returns integer language sql immutable as $$ select 60 $$;
revoke all on function public.voice_note_days() from public, anon, authenticated;
revoke all on function public.voice_note_cap() from public, anon, authenticated;

-- Writes the note one decision teaches, once; null when it teaches nothing (a skip without a reason, an edit the
-- classifier has not named yet, a note the founder deleted). `p_reason`: the skip reason, passed by the decide RPC.
create or replace function public.voice_note_write(p_outcome uuid, p_reason text default null)
returns public.cmo_memories language plpgsql volatile security definer set search_path = public
as $$
declare
  v_o public.cmo_draft_outcomes;
  v_item public.content_items;
  v_label text;
  v_body text;
  v_row public.cmo_memories;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_o from public.cmo_draft_outcomes where id = p_outcome;
  if not found or v_o.department <> 'post' or v_o.voice_note_deleted_at is not null then
    return null;
  end if;
  select * into v_row from public.cmo_memories where source_outcome = p_outcome;
  if found then
    return v_row;
  end if;
  select * into v_item from public.content_items where id = v_o.item_id and user_id = v_o.user_id;
  if not found then
    return null;
  end if;
  v_label := coalesce(public.platform_profile(coalesce(v_o.platform, 'x'))->>'label', 'X');
  v_body := case
    when v_o.action = 'skip' and v_reason is not null then
      'Skipped a draft on ' || v_label || ' about "' || left(v_item.idea, 120) || '": ' || v_reason
    when v_o.action = 'approve' and v_item.final_text is not null
         and (v_o.edit_mode = 'NO_MEANINGFUL_EDIT' or v_o.similarity >= public.cmo_as_written()) then
      'Approved as written on ' || v_label || ': "' || v_item.final_text || '"'
    when v_o.action = 'approve' and v_item.final_text is not null and public.voice_edit_phrase(v_o.edit_mode) is not null then
      'Edited on ' || v_label || ' before approving (' || public.voice_edit_phrase(v_o.edit_mode) || '): "'
        || v_item.final_text || '"'
    end;
  if v_body is null then
    return null;
  end if;
  insert into public.cmo_memories (user_id, type, kind, topic, importance, body, source_outcome, expires_at, created_at)
  values (v_o.user_id, 'agent', 'preference', 'post', 1, left(v_body, 600), p_outcome,
    now() + make_interval(days => public.voice_note_days()), now())
  on conflict (source_outcome) where source_outcome is not null do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.cmo_memories where source_outcome = p_outcome;
    return v_row;
  end if;
  -- Over the cap, the oldest notes go: they weigh least anyway.
  delete from public.cmo_memories where id in (
    select id from public.cmo_memories where user_id = v_o.user_id and source_outcome is not null
    order by created_at desc, id offset public.voice_note_cap());
  return v_row;
end;
$$;
revoke all on function public.voice_note_write(uuid, text) from public, anon, authenticated;

-- The note a decision teaches, for the founder (their own decisions only) or the service role (the nightly
-- classifier). Idempotent: a second call returns the same note.
create or replace function public.voice_note_add(p_outcome_id uuid)
returns public.cmo_memories language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
begin
  select user_id into v_owner from public.cmo_draft_outcomes where id = p_outcome_id;
  if v_owner is null
     or (v_user is not null and v_owner <> v_user)
     or (v_user is null and coalesce(auth.role(), '') <> 'service_role') then
    raise exception 'Decision not found.' using errcode = 'P0002';
  end if;
  return public.voice_note_write(p_outcome_id);
end;
$$;
revoke all on function public.voice_note_add(uuid) from public, anon;
grant execute on function public.voice_note_add(uuid) to authenticated, service_role;

-- The founder deletes a note; the decision is marked so the note is not written again.
create or replace function public.voice_note_delete(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_outcome uuid;
begin
  delete from public.cmo_memories where id = p_id and user_id = v_user and source_outcome is not null
  returning source_outcome into v_outcome;
  if not found then
    raise exception 'Voice note not found.' using errcode = 'P0002';
  end if;
  update public.cmo_draft_outcomes set voice_note_deleted_at = now() where id = v_outcome;
end;
$$;
revoke all on function public.voice_note_delete(uuid) from public, anon;
grant execute on function public.voice_note_delete(uuid) to authenticated;

-- A founder's live notes, newest first. `weight` is 1 for a note learned now and falls in a straight line to 0 when it
-- expires; `source` says what it was learned from. `p_platform`: one profile's notes only.
create or replace function public.voice_notes_of(p_user uuid, p_limit integer, p_platform text)
returns table (id uuid, body text, platform text, source text, edit_mode text, created_at timestamptz,
  expires_at timestamptz, weight real)
language sql stable security definer set search_path = public
as $$
  select m.id, m.body, o.platform,
    case when o.action = 'skip' then 'skipped'
      when o.edit_mode = 'NO_MEANINGFUL_EDIT' or o.similarity >= public.cmo_as_written() then 'approved'
      else 'edited' end,
    case when o.edit_mode = 'NO_MEANINGFUL_EDIT' then null else o.edit_mode end,
    m.created_at, m.expires_at,
    greatest(0, least(1, extract(epoch from (m.expires_at - now()))
      / nullif(extract(epoch from (m.expires_at - m.created_at)), 0)))::real
  from public.cmo_memories m
  join public.cmo_draft_outcomes o on o.id = m.source_outcome
  where m.user_id = p_user and m.expires_at > now() and (p_platform is null or o.platform = p_platform)
  order by m.created_at desc, m.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;
revoke all on function public.voice_notes_of(uuid, integer, text) from public, anon, authenticated;

create or replace function public.voice_notes(p_limit integer default 20, p_platform text default null)
returns table (id uuid, body text, platform text, source text, edit_mode text, created_at timestamptz,
  expires_at timestamptz, weight real)
language sql stable security definer set search_path = public
as $$ select * from public.voice_notes_of(public.require_user(), p_limit, p_platform) $$;
revoke all on function public.voice_notes(integer, text) from public, anon;
grant execute on function public.voice_notes(integer, text) to authenticated;

-- Writer (service role) reads the notes of the founder it drafts for.
create or replace function public.voice_notes_for(p_user uuid, p_limit integer default 20, p_platform text default null)
returns table (id uuid, body text, platform text, source text, edit_mode text, created_at timestamptz,
  expires_at timestamptz, weight real)
language sql stable security definer set search_path = public
as $$ select * from public.voice_notes_of(p_user, p_limit, p_platform) $$;
revoke all on function public.voice_notes_for(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.voice_notes_for(uuid, integer, text) to service_role;

-- ------------------------------------------------------------------ corrections from repeated edits

alter table public.cmo_corrections add column edit_mode text check (edit_mode in (
  'TOO_SALESY', 'WRONG_VOICE', 'INVENTED_CLAIM', 'TOO_LONG', 'HOOK_REWRITTEN', 'CTA_REMOVED'));
-- How many edits the rule was learned from (the card says "Learned from 3 of your edits").
alter table public.cmo_corrections add column times integer check (times between 1 and 100);
alter table public.cmo_corrections add constraint cmo_corrections_mode_times_check check ((edit_mode is null) = (times is null));
create index cmo_corrections_mode_idx on public.cmo_corrections (user_id, edit_mode, created_at desc) where edit_mode is not null;

-- The rule a repeated edit proposes, in the founder's voice. FULL_REWRITE says nothing a rule could hold.
create or replace function public.correction_rule(p_mode text) returns text
language sql immutable set search_path = public
as $$
  select case p_mode
    when 'TOO_SALESY' then 'Help first: drop the pitch and the hype.'
    when 'WRONG_VOICE' then 'Write the way I talk: plain words, short sentences, no marketing tone.'
    when 'INVENTED_CLAIM' then 'Never state a number, result or story that is not in my documents.'
    when 'TOO_LONG' then 'Keep it short: one idea, no extra lines.'
    when 'HOOK_REWRITTEN' then 'Open with a plain, specific first line.'
    when 'CTA_REMOVED' then 'End on the point itself: no closing ask, no summary line.'
    else null end
$$;
revoke all on function public.correction_rule(text) from public, anon, authenticated;

-- Proposes the rule when this decision's edit is the third of its kind in 14 days. Counts only edits made after the
-- last rule proposed for that edit (whatever became of it), and never while one waits. Returns the correction or null.
create or replace function public.correction_from_edits(p_outcome uuid) returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_o public.cmo_draft_outcomes;
  v_rule text;
  v_since timestamptz;
  v_n integer;
  v_edits jsonb;
  v_id uuid;
begin
  select * into v_o from public.cmo_draft_outcomes where id = p_outcome;
  v_rule := public.correction_rule(v_o.edit_mode);
  if v_o.id is null or v_rule is null or v_o.department <> 'post' or v_o.action <> 'approve' then
    return null;
  end if;
  -- The same lock as `cmo_propose_correction`: one proposal at a time per founder.
  perform pg_advisory_xact_lock(hashtextextended('cmo_corrections:' || v_o.user_id::text, 0));
  if exists (select 1 from public.cmo_corrections where user_id = v_o.user_id and edit_mode = v_o.edit_mode and status = 'proposed') then
    return null;
  end if;
  v_since := greatest(now() - interval '14 days', coalesce((
    select max(created_at) from public.cmo_corrections where user_id = v_o.user_id and edit_mode = v_o.edit_mode), '-infinity'));
  select count(*) into v_n from public.cmo_draft_outcomes
  where user_id = v_o.user_id and department = 'post' and action = 'approve' and edit_mode = v_o.edit_mode and decided_at > v_since;
  if v_n < 3 then
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
revoke all on function public.correction_from_edits(uuid) from public, anon, authenticated;

-- Every decision with a named edit, whoever wrote it (the decide RPC at once for a post approved as written, the
-- nightly classifier later for an edit): its voice note, then the rule check. A fault here never fails the decision.
create or replace function public.cmo_draft_outcomes_learn() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.edit_mode is null or (tg_op = 'UPDATE' and old.edit_mode is not distinct from new.edit_mode) then
    return new;
  end if;
  begin
    perform public.voice_note_write(new.id);
    perform public.correction_from_edits(new.id);
  exception when others then
    raise warning 'learning from decision % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.cmo_draft_outcomes_learn() from public, anon, authenticated;
create trigger cmo_draft_outcomes_learn after insert or update of edit_mode on public.cmo_draft_outcomes
  for each row execute function public.cmo_draft_outcomes_learn();

-- ------------------------------------------------------------------ deciding a post on its own platform

-- Same as 20261201100000, per platform: the profile's limit and its own daily cap of 5, the operation log under the
-- profile id, a skip reason's memory names the platform, and a reason becomes a voice note too.
create or replace function public.cmo_decide_post(p_id uuid, p_action text, p_text text default null, p_reason text default null)
returns public.content_items
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.require_user();
  v_row public.content_items;
  v_text text;
  v_versions text[];
  v_best real;
  v_best_index smallint;
  v_sim real;
  v_profile text;
  v_label text;
  v_limit integer;
  v_outcome uuid;
begin
  if p_action is null or p_action not in ('approve', 'skip') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':cmo_post', 1713));
  select * into v_row from public.content_items
  where id = p_id and user_id = v_user and department = 'post'
  for update;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'in_review' then
    raise exception 'This post was already decided.' using errcode = 'P0001';
  end if;
  -- A post on a platform without a post profile was planned for X (every post before P3).
  v_profile := public.platform_profile_id(v_row.platform);
  if v_profile is null or public.platform_profile(v_profile)->>'kind' <> 'post' then
    v_profile := 'x';
  end if;
  v_label := public.platform_profile(v_profile)->>'label';
  v_limit := (public.platform_profile(v_profile)->>'limit')::integer;

  if p_action = 'skip' then
    update public.content_items set status = 'skipped', decided_at = now(), updated_at = now()
    where id = p_id returning * into v_row;
    if p_reason is not null and char_length(trim(p_reason)) > 0 then
      insert into public.cmo_memories (user_id, type, topic, body)
      values (v_user, 'feedback', 'post', left('Skipped the ' || v_label || ' post "' || left(v_row.idea, 120) || '": ' || trim(p_reason), 600));
    end if;
    insert into public.cmo_draft_outcomes (user_id, item_id, department, action, model, prompt_version, platform)
    values (v_user, p_id, 'post', 'skip', left(coalesce(v_row.body->'gen'->>'model', ''), 100),
            left(coalesce(v_row.body->'gen'->>'prompt_version', ''), 40), v_profile)
    on conflict (department, item_id) do nothing
    returning id into v_outcome;
    if v_outcome is not null and p_reason is not null and char_length(trim(p_reason)) > 0 then
      begin
        perform public.voice_note_write(v_outcome, left(trim(p_reason), 400));
      exception when others then
        raise warning 'voice note for decision % failed: %', v_outcome, sqlerrm;
      end;
    end if;
    return v_row;
  end if;

  v_text := coalesce(nullif(trim(p_text), ''), v_row.body->>'text');
  if v_text is null or char_length(v_text) = 0 then
    raise exception 'This post is empty.' using errcode = '22023';
  end if;
  if char_length(v_text) > v_limit then
    raise exception 'Posts on % can be at most % characters.', v_label, to_char(v_limit, 'FM999,999') using errcode = '22023';
  end if;
  if (select count(*) from public.operation_log
      where user_id = v_user and platform = v_profile and action = 'approve' and at > now() - interval '1 day') >= 5 then
    raise exception 'You can approve 5 posts for % a day. Try again tomorrow.', v_label using errcode = 'P0001';
  end if;
  insert into public.operation_log (user_id, platform, action, target) values (v_user, v_profile, 'approve', p_id::text);
  update public.content_items set status = 'approved', final_text = v_text, decided_at = now(), updated_at = now()
  where id = p_id returning * into v_row;

  -- Version 0 is `text`, 1–2 the alternates, in the order the card shows them.
  v_versions := array[v_row.body->>'text'] || coalesce(array(
    select jsonb_array_elements_text(v_row.body->'alternates')
    where jsonb_typeof(v_row.body->'alternates') = 'array'), '{}');
  for i in 1 .. least(coalesce(array_length(v_versions, 1), 0), 3) loop
    continue when v_versions[i] is null;
    v_sim := case when v_versions[i] = v_text then 1 else extensions.similarity(v_versions[i], v_text) end;
    if v_best is null or v_sim > v_best then
      v_best := v_sim;
      v_best_index := i - 1;
    end if;
  end loop;
  -- A post approved as written is labelled at once; its voice note comes from the outcome's own trigger.
  insert into public.cmo_draft_outcomes (
    user_id, item_id, department, action, chosen_version, similarity, edit_mode, classified_at, model, prompt_version, platform
  ) values (
    v_user, p_id, 'post', 'approve', v_best_index, v_best,
    case when v_best >= public.cmo_as_written() then 'NO_MEANINGFUL_EDIT' end,
    case when v_best >= public.cmo_as_written() then now() end,
    left(coalesce(v_row.body->'gen'->>'model', ''), 100), left(coalesce(v_row.body->'gen'->>'prompt_version', ''), 40),
    v_profile
  )
  on conflict (department, item_id) do nothing;
  return v_row;
end;
$$;

-- ------------------------------------------------------------------ the correction card

-- Same as 20261228110000, plus what a correction learned from a repeated edit says: the edit and how many times. Only
-- for such a rule, so a card raised before keeps its hash.
create or replace function public.approval_snapshot(p_ref_kind text, p_ref_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v jsonb;
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
    else
      raise exception 'Unknown card source.' using errcode = '22023';
  end case;
  return v;
end;
$$;
revoke all on function public.approval_snapshot(text, uuid) from public, anon, authenticated;

commit;
