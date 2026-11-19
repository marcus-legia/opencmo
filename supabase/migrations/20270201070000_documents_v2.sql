-- Wave 3 A4 (docs/plans/cmo/2026-11-20-wave3-plan.md §3): documents v2.
--   Strategy gains `where_they_ask` and `this_week`; `voice` and `avoid` move to a new `brand` document (with writing
--   samples, an intro line and the look). `content_strategy` becomes `post_plan` (topics, channels, rhythm).
-- No data is dropped: a Content Strategy row becomes a Post plan row in place, with its old body under `legacy`, and
-- old Strategy versions keep their `voice` and `avoid` (the app no longer reads them there). `content_strategy` stays
-- in the kind check only so a row the migration has not seen yet is still valid; no RPC writes it any more.

alter table public.marketing_documents drop constraint marketing_documents_kind_check;
alter table public.marketing_documents add constraint marketing_documents_kind_check
  check (kind in ('product', 'strategy', 'competitors', 'post_plan', 'brand', 'calendar', 'content_strategy'));

-- The founder's channels, from their onboarding answer, in the app's order (`POST_CHANNELS`).
create function public.documents_v2_channels(p_platforms text[])
returns jsonb
  language sql immutable
  set search_path to ''
as $$
  select coalesce(jsonb_agg(c order by array_position(array['x', 'linkedin', 'threads'], c)), '[]'::jsonb)
  from (select distinct c from unnest(coalesce(p_platforms, '{}')) c where c in ('x', 'linkedin', 'threads')) s;
$$;
revoke all on function public.documents_v2_channels(text[]) from public, anon, authenticated;

-- The move itself, idempotent: a rerun finds no Content Strategy row and no founder without a Brand.
create function public.documents_v2_migrate()
returns integer
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_count integer := 0;
  v_n integer;
begin
  -- Post plan: the pillars' names become topics, the weekly rhythm stays, the rest is kept under `legacy`.
  update public.marketing_documents d set
    kind = 'post_plan',
    body = jsonb_build_object(
      'topics', coalesce((
        select jsonb_agg(left(btrim(p->>'name'), 300)) from (
          select p from jsonb_array_elements(case when jsonb_typeof(d.body->'pillars') = 'array' then d.body->'pillars' else '[]'::jsonb end) p
          where jsonb_typeof(p) = 'object' and btrim(coalesce(p->>'name', '')) <> '' limit 12
        ) s), '[]'::jsonb),
      'channels', public.documents_v2_channels((select pr.post_platforms from public.profiles pr where pr.id = d.user_id)),
      'rhythm', left(coalesce(d.body->>'cadence', ''), 1500),
      'legacy', d.body)
  where d.kind = 'content_strategy'
    and not exists (select 1 from public.marketing_documents x where x.user_id = d.user_id and x.kind = 'post_plan' and x.version = d.version);
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  -- Brand: one first version per founder with a Strategy, from its newest voice and words to avoid. The voice history
  -- trigger is told to stay quiet: nothing changed for the founder.
  perform set_config('opencmo.voice_undo', 'on', true);
  insert into public.marketing_documents (user_id, kind, version, body, created_by)
  select s.user_id, 'brand', 1, jsonb_build_object(
      'voice', coalesce(case when jsonb_typeof(s.body->'voice') = 'string' then s.body->>'voice' end, ''),
      'voice_samples', '[]'::jsonb,
      'intro_line', '',
      'avoid', case when jsonb_typeof(s.body->'avoid') = 'array' then s.body->'avoid' else '[]'::jsonb end,
      'look', jsonb_build_object('logo_url', '', 'colors', '[]'::jsonb, 'font', '', 'screenshots', '[]'::jsonb, 'image_styles', '[]'::jsonb)),
    s.created_by
  from (
    select distinct on (m.user_id) m.user_id, m.body, m.created_by
    from public.marketing_documents m where m.kind = 'strategy'
    order by m.user_id, m.version desc
  ) s
  where not exists (select 1 from public.marketing_documents b where b.user_id = s.user_id and b.kind = 'brand');
  get diagnostics v_n = row_count;
  perform set_config('opencmo.voice_undo', '', true);
  return v_count + v_n;
end;
$$;
revoke all on function public.documents_v2_migrate() from public, anon, authenticated;

select public.documents_v2_migrate();

-- The voice history follows the Brand now (the Settings › Voice page and its Undo).
create or replace function public.marketing_documents_voice_events()
returns trigger
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_prev jsonb;
  v_field text;
begin
  if new.kind <> 'brand' or coalesce(current_setting('opencmo.voice_undo', true), '') = 'on' then
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
    where user_id = new.user_id and kind = 'brand' and version < new.version
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

create or replace function public.cmo_voice_undo(p_event uuid)
returns public.cmo_voice_events
  language plpgsql security definer
  set search_path to 'public'
as $$
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
    perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':doc:brand', 1713));
    select * into v_doc from public.marketing_documents
    where user_id = v_user and kind = 'brand' order by version desc limit 1;
    if found then
      insert into public.marketing_documents (user_id, kind, version, body, created_by)
      values (v_user, 'brand', v_doc.version + 1,
        -- The document keeps both fields (BrandSchema): one that had no value before is emptied, not removed.
        jsonb_set(v_doc.body, array[v_event.field],
          coalesce(v_event.before, case v_event.field when 'avoid' then '[]'::jsonb else '""'::jsonb end)), 'user');
    end if;
  end if;
  perform set_config('opencmo.voice_undo', '', true);
  update public.cmo_voice_events set undone_at = now() where id = v_event.id returning * into v_event;
  return v_event;
end;
$$;

create or replace function public.save_marketing_document(p_kind text, p_body jsonb, p_run uuid default null)
returns public.marketing_documents
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_by text := 'user';
  v_row public.marketing_documents;
begin
  if p_kind is null or p_kind not in ('product', 'strategy', 'competitors', 'post_plan', 'brand', 'calendar') then
    raise exception 'Unknown document.' using errcode = '22023';
  end if;
  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'This document is not valid.' using errcode = '22023';
  end if;
  if octet_length(p_body::text) > 65536 then
    raise exception 'This document is too long.' using errcode = '22023';
  end if;
  if p_run is not null then
    if not exists(select 1 from public.cmo_runs where id = p_run and user_id = v_user and status = 'running') then
      raise exception 'This task has already finished.' using errcode = 'P0002';
    end if;
    v_by := 'agent';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':doc:' || p_kind, 1713));
  insert into public.marketing_documents (user_id, kind, version, body, created_by)
  values (
    v_user, p_kind,
    coalesce((select max(version) from public.marketing_documents where user_id = v_user and kind = p_kind), 0) + 1,
    p_body, v_by
  )
  returning * into v_row;
  return v_row;
end;
$$;

-- The onboarding answers: the platforms the founder posts on become the Post plan's channels (they were a sentence in
-- the old weekly rhythm).
create or replace function public.cmo_apply_onboarding_answers(p_user uuid, p_handle_given boolean default false)
returns void
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_profile public.profiles;
  v_doc public.marketing_documents;
  v_channels jsonb;
begin
  select * into v_profile from public.profiles where id = p_user;
  if not found then
    return;
  end if;

  if v_profile.x_handle is not null then
    -- The same lock `save_marketing_document` takes, so a version number is never taken twice.
    perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':doc:product', 1713));
    select * into v_doc from public.marketing_documents where user_id = p_user and kind = 'product' order by version desc limit 1;
    if found and (coalesce(btrim(v_doc.body->>'x_handle'), '') = ''
        or (p_handle_given and lower(regexp_replace(btrim(v_doc.body->>'x_handle'), '^@', '')) <> lower(v_profile.x_handle))) then
      insert into public.marketing_documents (user_id, kind, version, body, created_by)
      values (p_user, 'product', v_doc.version + 1, v_doc.body || jsonb_build_object('x_handle', '@' || v_profile.x_handle), 'user');
    end if;
  end if;

  if v_profile.post_platforms is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':doc:post_plan', 1713));
    select * into v_doc from public.marketing_documents where user_id = p_user and kind = 'post_plan' order by version desc limit 1;
    v_channels := public.documents_v2_channels(v_profile.post_platforms);
    if found and jsonb_array_length(v_channels) > 0 and v_doc.body->'channels' is distinct from v_channels then
      insert into public.marketing_documents (user_id, kind, version, body, created_by)
      values (p_user, 'post_plan', v_doc.version + 1, v_doc.body || jsonb_build_object('channels', v_channels), 'user');
    end if;
  end if;
end;
$$;
