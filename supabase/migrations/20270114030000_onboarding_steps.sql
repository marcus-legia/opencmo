-- CMO review 3, 3.2: onboarding shows its real steps and asks three optional questions while it runs.
--
-- Steps: `runOnboarding` writes them to its own run as the founder (`cmo_onboard_step`): reading the site, then each
-- document as it is saved. Setup reads the run, then the plan and draft runs that follow, every 2 s.
--
-- Answers: the X handle, the platforms the founder posts on, and how they heard of OpenCMO. They are kept on the
-- profile and applied to the documents the CMO already reads, so nothing new has to learn to read them:
--   - the handle goes into the Product document when it has none (metrics and research read `product.x_handle`);
--   - the platforms go at the front of the Content plan's weekly rhythm (`content_strategy.cadence`), which the planner
--     reads for "Threads or LinkedIn". If the plan has not started yet it reads the answer; otherwise the next one does.
-- An answer given before the documents exist is applied when onboarding saves them (`p_answers = {}`).

alter table public.profiles
  add column if not exists x_handle text,
  add column if not exists post_platforms text[],
  add column if not exists heard_from text,
  add column if not exists heard_from_note text;

alter table public.profiles drop constraint if exists profiles_x_handle_check;
alter table public.profiles add constraint profiles_x_handle_check check (x_handle is null or x_handle ~ '^[A-Za-z0-9_]{1,15}$');
alter table public.profiles drop constraint if exists profiles_post_platforms_check;
alter table public.profiles add constraint profiles_post_platforms_check
  check (post_platforms is null or (cardinality(post_platforms) between 1 and 3 and post_platforms <@ array['x', 'threads', 'linkedin']));
alter table public.profiles drop constraint if exists profiles_heard_from_check;
alter table public.profiles add constraint profiles_heard_from_check check (heard_from is null or heard_from in
  ('search', 'x', 'reddit', 'linkedin', 'youtube', 'ai_assistant', 'friend', 'newsletter', 'other'));
alter table public.profiles drop constraint if exists profiles_heard_from_note_check;
alter table public.profiles add constraint profiles_heard_from_note_check check (heard_from_note is null or char_length(heard_from_note) <= 100);

-- The founder's step list on their own running onboarding run. Only ids and states: Setup words each step itself.
create or replace function public.cmo_onboard_step(p_run uuid, p_steps jsonb) returns boolean
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 12
     or exists (
       select 1 from jsonb_array_elements(p_steps) e
       where jsonb_typeof(e) <> 'object'
          or coalesce(e->>'id', '') !~ '^[a-z_]{1,40}$'
          or coalesce(e->>'status', '') not in ('running', 'done', 'failed')
          or (select count(*) from jsonb_object_keys(e)) <> 2
     ) then
    raise exception 'These steps are not valid.' using errcode = '22023';
  end if;
  update public.cmo_runs set steps = p_steps
  where id = p_run and user_id = v_user and kind = 'onboard' and status = 'running';
  return found;
end;
$$;

revoke all on function public.cmo_onboard_step(uuid, jsonb) from public, anon;
grant execute on function public.cmo_onboard_step(uuid, jsonb) to authenticated, service_role;

-- Internal: applies the saved answers to the latest documents. Idempotent: a second call changes nothing. The handle
-- fills an empty Product handle; `p_handle_given` (the founder just typed it) also replaces one the CMO guessed.
create or replace function public.cmo_apply_onboarding_answers(p_user uuid, p_handle_given boolean default false) returns void
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_profile public.profiles;
  v_doc public.marketing_documents;
  v_line text;
  v_cadence text;
  v_next text;
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
    perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':doc:content_strategy', 1713));
    select * into v_doc from public.marketing_documents where user_id = p_user and kind = 'content_strategy' order by version desc limit 1;
    if found then
      v_line := 'The founder posts on ' || (
        select string_agg(case p when 'x' then 'X' when 'threads' then 'Threads' else 'LinkedIn' end, ', ' order by array_position(array['x', 'threads', 'linkedin'], p))
        from unnest(v_profile.post_platforms) p
      ) || case when v_profile.post_platforms = array['x'] then ' only.' else '.' end;
      v_cadence := coalesce(v_doc.body->>'cadence', '');
      -- One such sentence, always first: the earlier answer is replaced, the founder's own words are kept.
      -- concat, not ||: an empty rhythm must leave the sentence alone, never make the whole value null.
      v_next := btrim(concat(v_line, ' ', btrim(regexp_replace(v_cadence, 'The founder posts on [^.]*\.\s*', '', 'g'))));
      if v_next is distinct from v_cadence then
        insert into public.marketing_documents (user_id, kind, version, body, created_by)
        values (p_user, 'content_strategy', v_doc.version + 1, v_doc.body || jsonb_build_object('cadence', v_next), 'user');
      end if;
    end if;
  end if;
end;
$$;

revoke all on function public.cmo_apply_onboarding_answers(uuid, boolean) from public, anon, authenticated;

-- The three optional questions. Each key is optional; `{}` only applies what was saved before. Unknown keys and values
-- out of their lists are refused, so the profile only ever holds what Setup offers.
create or replace function public.cmo_onboarding_answers(p_answers jsonb) returns void
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_handle text;
  v_platforms text[];
  v_heard text;
  v_note text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 1024
     or exists (select 1 from jsonb_object_keys(p_answers) k where k not in ('x_handle', 'platforms', 'heard_from', 'heard_from_note')) then
    raise exception 'These answers are not valid.' using errcode = '22023';
  end if;

  if p_answers ? 'x_handle' then
    v_handle := regexp_replace(btrim(coalesce(p_answers->>'x_handle', '')), '^@', '');
    if v_handle !~ '^[A-Za-z0-9_]{1,15}$' then
      raise exception 'An X handle has 1 to 15 letters, numbers or underscores.' using errcode = '22023';
    end if;
  end if;
  if p_answers ? 'platforms' then
    if jsonb_typeof(p_answers->'platforms') <> 'array' then
      raise exception 'These answers are not valid.' using errcode = '22023';
    end if;
    select array_agg(distinct v) into v_platforms from jsonb_array_elements_text(p_answers->'platforms') v;
    if v_platforms is null or not (v_platforms <@ array['x', 'threads', 'linkedin']) then
      raise exception 'Pick X, Threads or LinkedIn.' using errcode = '22023';
    end if;
  end if;
  if p_answers ? 'heard_from' then
    v_heard := p_answers->>'heard_from';
    if v_heard is null or v_heard not in ('search', 'x', 'reddit', 'linkedin', 'youtube', 'ai_assistant', 'friend', 'newsletter', 'other') then
      raise exception 'These answers are not valid.' using errcode = '22023';
    end if;
    v_note := nullif(left(btrim(coalesce(p_answers->>'heard_from_note', '')), 100), '');
  elsif p_answers ? 'heard_from_note' then
    raise exception 'These answers are not valid.' using errcode = '22023';
  end if;

  update public.profiles set
    x_handle = coalesce(v_handle, x_handle),
    post_platforms = coalesce(v_platforms, post_platforms),
    heard_from = coalesce(v_heard, heard_from),
    heard_from_note = case when v_heard is not null then v_note else heard_from_note end
  where id = v_user;

  perform public.cmo_apply_onboarding_answers(v_user, v_handle is not null);
end;
$$;

revoke all on function public.cmo_onboarding_answers(jsonb) from public, anon;
grant execute on function public.cmo_onboarding_answers(jsonb) to authenticated, service_role;
