-- Wave 3, for B4 (A.md Requests): onboarding asks "who do you sell to?" while the site is read (the fit test). The
-- answer is kept on the profile and written into the Strategy's ideal customer: the founder's words win over the
-- website's guess.

alter table public.profiles add column sells_to text check (sells_to is null or char_length(sells_to) between 1 and 160);

-- One more flag: whether the founder gave the answer in this call.
drop function public.cmo_apply_onboarding_answers(uuid, boolean);

create function public.cmo_apply_onboarding_answers(p_user uuid, p_handle_given boolean default false, p_sells_given boolean default false)
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

  -- "Who do you sell to?" in the founder's words: it replaces the website's guess at the ideal customer (a Strategy the
  -- agent wrote), or any icp when the founder answers now; a later edit of their own is not overwritten by a re-apply.
  if v_profile.sells_to is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':doc:strategy', 1713));
    select * into v_doc from public.marketing_documents where user_id = p_user and kind = 'strategy' order by version desc limit 1;
    if found and (p_sells_given or v_doc.created_by = 'agent') and v_doc.body->>'icp' is distinct from v_profile.sells_to then
      insert into public.marketing_documents (user_id, kind, version, body, created_by)
      values (p_user, 'strategy', v_doc.version + 1, v_doc.body || jsonb_build_object('icp', v_profile.sells_to), 'user');
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
revoke all on function public.cmo_apply_onboarding_answers(uuid, boolean, boolean) from public, anon, authenticated;

create or replace function public.cmo_onboarding_answers(p_answers jsonb)
returns void
  language plpgsql security definer
  set search_path to 'public'
as $_$
declare
  v_user uuid := public.require_user();
  v_handle text;
  v_platforms text[];
  v_heard text;
  v_note text;
  v_sells text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 1024
     or exists (select 1 from jsonb_object_keys(p_answers) k where k not in ('x_handle', 'platforms', 'heard_from', 'heard_from_note', 'sells_to')) then
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
  if p_answers ? 'sells_to' then
    v_sells := btrim(regexp_replace(coalesce(p_answers->>'sells_to', ''), '\s+', ' ', 'g'));
    if jsonb_typeof(p_answers->'sells_to') <> 'string' or char_length(v_sells) not between 1 and 160 then
      raise exception 'Say who you sell to in 1 to 160 characters.' using errcode = '22023';
    end if;
  end if;

  update public.profiles set
    x_handle = coalesce(v_handle, x_handle),
    post_platforms = coalesce(v_platforms, post_platforms),
    heard_from = coalesce(v_heard, heard_from),
    heard_from_note = case when v_heard is not null then v_note else heard_from_note end,
    sells_to = coalesce(v_sells, sells_to)
  where id = v_user;

  perform public.cmo_apply_onboarding_answers(v_user, v_handle is not null, v_sells is not null);
end;
$_$;
