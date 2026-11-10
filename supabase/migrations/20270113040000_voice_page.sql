-- cmo-review-3 2.3 (session A): the voice as a page with history and Undo. Every change to what the Writer follows
-- writes one event: a rule approved, edited, turned off or on (the card, the rating sheet, the Voice page) and the
-- strategy's `voice` and `avoid` (onboarding or the Business document). Undo reverts the latest event the founder has
-- not undone; twice in a row reverts the one before.

begin;

create table if not exists public.cmo_voice_events (
  id uuid primary key default gen_random_uuid(),
  -- The order of events, also within one transaction (where `created_at` is the same): Undo takes the highest.
  seq bigint generated always as identity,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- A rule (`correction_id`) or a field of the strategy document (`field`).
  correction_id uuid references public.cmo_corrections(id) on delete cascade,
  field text check (field in ('voice', 'avoid')),
  -- Who changed it, as the page names it: Setup, You, Your CMO (the chat), Learned from your edits, From your ratings.
  source text not null check (source in ('setup', 'you', 'cmo', 'edits', 'ratings')),
  -- The strategy version that made a field's event (the chat names itself after the insert: see the trigger).
  document_id uuid references public.marketing_documents(id) on delete cascade,
  before jsonb,
  after jsonb,
  before_status text check (before_status in ('proposed', 'active', 'rejected')),
  after_status text check (after_status in ('proposed', 'active', 'rejected')),
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cmo_voice_events_one_target check ((correction_id is null) <> (field is null)),
  constraint cmo_voice_events_size check (octet_length(coalesce(before::text, '')) <= 8192 and octet_length(coalesce(after::text, '')) <= 8192)
);
create index if not exists cmo_voice_events_user_idx on public.cmo_voice_events (user_id, seq desc);
alter table public.cmo_voice_events enable row level security;
drop policy if exists "read own voice events" on public.cmo_voice_events;
create policy "read own voice events" on public.cmo_voice_events for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.cmo_voice_events from anon, authenticated;
grant select on public.cmo_voice_events to authenticated;
grant select, insert, update, delete on public.cmo_voice_events to service_role;

-- One rule changed: an event when what the Writer follows changed (a rule became active, its words changed while
-- active, or it was turned off). Undo writes none (`opencmo.voice_undo`).
CREATE OR REPLACE FUNCTION public.cmo_voice_rule_event(p_before public.cmo_corrections, p_after public.cmo_corrections, p_source text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if coalesce(current_setting('opencmo.voice_undo', true), '') = 'on' then
    return;
  end if;
  if p_before.status is not distinct from p_after.status and p_before.rule is not distinct from p_after.rule then
    return;
  end if;
  if p_before.status is distinct from 'active' and p_after.status is distinct from 'active' then
    return;
  end if;
  insert into public.cmo_voice_events (user_id, correction_id, source, before, after, before_status, after_status)
  values (p_after.user_id, p_after.id, p_source,
    case when p_before.status = 'active' then to_jsonb(p_before.rule) end, to_jsonb(p_after.rule),
    p_before.status, p_after.status);
end;
$$;

CREATE OR REPLACE FUNCTION public.cmo_decide_correction(p_id uuid, p_action text, p_text text DEFAULT NULL::text) RETURNS public.cmo_corrections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_row public.cmo_corrections;
  v_before public.cmo_corrections;
  v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if p_action is null or p_action not in ('approve', 'edit', 'reject') then
    raise exception 'Choose approve, edit or reject.' using errcode = '22023';
  end if;
  if p_action = 'edit' and (v_text is null or char_length(v_text) < 3 or char_length(v_text) > 200) then
    raise exception 'Write the rule in 3 to 200 characters.' using errcode = '22023';
  end if;
  select * into v_row from public.cmo_corrections where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Rule not found.' using errcode = 'P0002';
  end if;
  if v_row.status = 'rejected' or (v_row.status = 'active' and p_action <> 'reject') then
    raise exception 'This rule was already decided.' using errcode = 'P0001';
  end if;
  v_before := v_row;
  update public.cmo_corrections
  set status = case p_action when 'reject' then 'rejected' else 'active' end,
      rule = case p_action when 'edit' then v_text else rule end,
      decided_at = now()
  where id = v_row.id
  returning * into v_row;
  -- The page's history (cmo-review-3 2.3): kept as learned, or in the founder's own words.
  perform public.cmo_voice_rule_event(v_before, v_row,
    case when p_action = 'approve' then case v_row.source when 'ratings' then 'ratings' else 'edits' end else 'you' end);
  return v_row;
end;
$$;

CREATE OR REPLACE FUNCTION public.cmo_accept_corrections(p_round uuid, p_ids uuid[], p_texts text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_n integer := coalesce(cardinality(p_ids), 0);
  v_text text;
  v_before public.cmo_corrections;
  v_after public.cmo_corrections;
  v_done integer := 0;
begin
  if v_n > 5 or v_n <> coalesce(cardinality(p_texts), 0) then
    raise exception 'Send each ticked rule with its words.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.cmo_corrections where user_id = v_user and round_id = p_round and source = 'ratings') then
    raise exception 'These rules were not found.' using errcode = 'P0002';
  end if;
  for i in 1 .. v_n loop
    v_text := trim(coalesce(p_texts[i], ''));
    if char_length(v_text) not between 3 and 200 then
      raise exception 'Write each rule in 3 to 200 characters.' using errcode = '22023';
    end if;
    select * into v_before from public.cmo_corrections
    where id = p_ids[i] and user_id = v_user and round_id = p_round and source = 'ratings' and status = 'proposed' for update;
    if not found then
      raise exception 'This rule was already decided.' using errcode = 'P0001';
    end if;
    update public.cmo_corrections set status = 'active', rule = v_text, decided_at = now()
    where id = v_before.id returning * into v_after;
    -- Kept with the founder's words: "From your ratings" either way (the founder edits on the sheet).
    perform public.cmo_voice_rule_event(v_before, v_after, 'ratings');
    v_done := v_done + 1;
  end loop;
  update public.cmo_corrections set status = 'rejected', decided_at = now()
  where user_id = v_user and round_id = p_round and source = 'ratings' and status = 'proposed';
  return v_done;
end;
$$;

-- The Voice page's edit: a rule's words, or turning it off and on again. Only rules that were decided.
CREATE OR REPLACE FUNCTION public.cmo_edit_correction(p_id uuid, p_text text DEFAULT NULL::text, p_active boolean DEFAULT NULL::boolean) RETURNS public.cmo_corrections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_row public.cmo_corrections;
  v_before public.cmo_corrections;
  v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if p_text is not null and (v_text is null or char_length(v_text) not between 3 and 200) then
    raise exception 'Write the rule in 3 to 200 characters.' using errcode = '22023';
  end if;
  if v_text is null and p_active is null then
    raise exception 'Change the words, or turn the rule on or off.' using errcode = '22023';
  end if;
  select * into v_row from public.cmo_corrections where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Rule not found.' using errcode = 'P0002';
  end if;
  if v_row.status = 'proposed' then
    raise exception 'Decide this rule on its card first.' using errcode = 'P0001';
  end if;
  v_before := v_row;
  update public.cmo_corrections
  set rule = coalesce(v_text, rule),
      status = case when p_active is null then status when p_active then 'active' else 'rejected' end,
      decided_at = now()
  where id = v_row.id
  returning * into v_row;
  perform public.cmo_voice_rule_event(v_before, v_row, 'you');
  return v_row;
end;
$$;

-- The strategy's voice and avoid list: an event per field that changed, from the version before. A job's save
-- (onboarding, `created_by = 'agent'` at insert) is Setup; the founder's own save is "You". The CMO chat saves as the
-- founder and then marks the version `agent` (`cmo_chat_save_document`): that update makes its events "Your CMO".
CREATE OR REPLACE FUNCTION public.marketing_documents_voice_events() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_prev jsonb;
  v_field text;
begin
  if new.kind <> 'strategy' or coalesce(current_setting('opencmo.voice_undo', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.created_by = 'user' and new.created_by = 'agent' then
      update public.cmo_voice_events set source = 'cmo' where document_id = new.id and source = 'you';
    end if;
    return new;
  end if;
  begin
    select body into v_prev from public.marketing_documents
    where user_id = new.user_id and kind = 'strategy' and version < new.version
    order by version desc limit 1;
    foreach v_field in array array['voice', 'avoid'] loop
      continue when (v_prev->v_field) is not distinct from (new.body->v_field);
      continue when v_prev is null and new.body->v_field is null;
      insert into public.cmo_voice_events (user_id, field, source, before, after, document_id)
      values (new.user_id, v_field, case when new.created_by = 'user' then 'you' else 'setup' end,
        v_prev->v_field, new.body->v_field, new.id);
    end loop;
  exception when others then
    -- The history is a view of the change; never a reason a document is not saved.
    raise warning 'voice event for document % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists marketing_documents_voice_events on public.marketing_documents;
create trigger marketing_documents_voice_events after insert or update of created_by on public.marketing_documents
  for each row execute function public.marketing_documents_voice_events();

-- Undo: the founder's latest event that is not undone is reverted, and marked so; the next Undo takes the one before.
-- `p_event` is the event the page showed with its Undo: if a newer change came in meanwhile, nothing is undone and the
-- page reads again. A rule goes back to its words and its state before (one that was only proposed is set aside, so
-- it does not ask again); a strategy field goes back to its value before (empty when it had none), as a new version.
CREATE OR REPLACE FUNCTION public.cmo_voice_undo(p_event uuid) RETURNS public.cmo_voice_events
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_event public.cmo_voice_events;
  v_doc public.marketing_documents;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':voice', 1713));
  select * into v_event from public.cmo_voice_events
  where user_id = v_user and undone_at is null order by seq desc limit 1 for update;
  if not found then
    raise exception 'There is nothing to undo.' using errcode = 'P0002';
  end if;
  if v_event.id is distinct from p_event then
    raise exception 'Your voice changed since this page loaded. Look at the history again before undoing.' using errcode = 'P0001';
  end if;
  perform set_config('opencmo.voice_undo', 'on', true);
  if v_event.correction_id is not null then
    update public.cmo_corrections
    set rule = coalesce(v_event.before #>> '{}', rule),
        status = case v_event.before_status when 'active' then 'active' else 'rejected' end,
        decided_at = now()
    where id = v_event.correction_id and user_id = v_user;
  else
    perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':doc:strategy', 1713));
    select * into v_doc from public.marketing_documents
    where user_id = v_user and kind = 'strategy' order by version desc limit 1;
    if found then
      insert into public.marketing_documents (user_id, kind, version, body, created_by)
      values (v_user, 'strategy', v_doc.version + 1,
        -- The document keeps both fields (StrategySchema): one that had no value before is emptied, not removed.
        jsonb_set(v_doc.body, array[v_event.field],
          coalesce(v_event.before, case v_event.field when 'avoid' then '[]'::jsonb else '""'::jsonb end)), 'user');
    end if;
  end if;
  perform set_config('opencmo.voice_undo', '', true);
  update public.cmo_voice_events set undone_at = now() where id = v_event.id returning * into v_event;
  return v_event;
end;
$$;

revoke all on function public.cmo_voice_rule_event(public.cmo_corrections, public.cmo_corrections, text) from public, anon, authenticated;
revoke all on function public.marketing_documents_voice_events() from public, anon, authenticated;
revoke all on function public.cmo_edit_correction(uuid, text, boolean) from public, anon;
grant execute on function public.cmo_edit_correction(uuid, text, boolean) to authenticated;
revoke all on function public.cmo_voice_undo(uuid) from public, anon;
grant execute on function public.cmo_voice_undo(uuid) to authenticated;

commit;
