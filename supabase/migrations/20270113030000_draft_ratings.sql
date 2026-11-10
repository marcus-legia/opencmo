-- cmo-review-3 2.2 (session A): "Rate your first drafts". The founder rates up to five versions of waiting posts
-- (thumbs, a chip on a thumbs down, a note); rating is not deciding, so the cards stay. One round a day queues
-- `distill_ratings` (Haiku, free), which writes at most five rules grounded in the ratings as proposed corrections
-- with `source = 'ratings'`. They raise no card: the founder ticks and edits them on the sheet and accepts them in one
-- step (`cmo_accept_corrections`).

begin;

alter table public.cmo_corrections
  add column if not exists source text not null default 'edits',
  add column if not exists round_id uuid;
alter table public.cmo_corrections drop constraint if exists cmo_corrections_source_check;
alter table public.cmo_corrections add constraint cmo_corrections_source_check check (source in ('edits', 'ratings', 'founder'));

create table if not exists public.cmo_draft_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.content_items(id) on delete cascade,
  version smallint not null check (version between 0 and 2),
  verdict text not null check (verdict in ('up', 'down')),
  reason_code text check (reason_code in ('TOO_SALESY', 'WRONG_VOICE', 'INVENTED_CLAIM', 'TOO_LONG', 'HOOK_REWRITTEN', 'OFF_TOPIC', 'OTHER')),
  note text check (char_length(note) <= 200),
  -- The words rated, as they were: the rules are grounded in them even after a redraft.
  words text not null check (char_length(words) between 1 and 3000),
  round uuid not null,
  created_at timestamptz not null default now(),
  constraint cmo_draft_ratings_reason_on_down check (reason_code is null or verdict = 'down'),
  unique (round, item_id, version)
);
create index if not exists cmo_draft_ratings_user_idx on public.cmo_draft_ratings (user_id, created_at desc);
create index if not exists cmo_draft_ratings_item_idx on public.cmo_draft_ratings (item_id);
alter table public.cmo_draft_ratings enable row level security;
drop policy if exists "read own draft ratings" on public.cmo_draft_ratings;
create policy "read own draft ratings" on public.cmo_draft_ratings for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.cmo_draft_ratings from anon, authenticated;
grant select on public.cmo_draft_ratings to authenticated;
grant select, insert, update, delete on public.cmo_draft_ratings to service_role;

-- One round: at most five versions of the founder's waiting posts, rated once each. Answers the round and its job.
CREATE OR REPLACE FUNCTION public.cmo_rate_drafts(p_ratings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_round uuid := gen_random_uuid();
  v_r jsonb;
  v_item public.content_items;
  v_version integer;
  v_words text;
  v_code text;
  v_note text;
  v_run public.cmo_runs;
begin
  if p_ratings is null or jsonb_typeof(p_ratings) <> 'array' or jsonb_array_length(p_ratings) not between 1 and 5 then
    raise exception 'Rate one to five drafts.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':cmo_ratings', 1713));
  if exists (select 1 from public.cmo_draft_ratings where user_id = v_user and created_at > now() - interval '1 day') then
    raise exception 'You rated drafts today. Rate again tomorrow.' using errcode = 'P0001';
  end if;
  for v_r in select value from jsonb_array_elements(p_ratings) loop
    if jsonb_typeof(v_r) <> 'object' or coalesce(v_r->>'item_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_r->'version') is distinct from 'number' or v_r->>'verdict' not in ('up', 'down') then
      raise exception 'A rating is malformed.' using errcode = '22023';
    end if;
    select * into v_item from public.content_items
    where id = (v_r->>'item_id')::uuid and user_id = v_user and department = 'post' and status = 'in_review';
    if not found then
      raise exception 'Only drafts that wait for you can be rated.' using errcode = 'P0002';
    end if;
    v_version := (v_r->>'version')::numeric::integer;
    v_words := case when v_version = 0 then v_item.body->>'text'
      when v_version in (1, 2) and jsonb_typeof(v_item.body->'alternates') = 'array' then v_item.body->'alternates'->>(v_version - 1) end;
    if (v_r->>'version')::numeric <> v_version or coalesce(v_words, '') = '' then
      raise exception 'That version is not on the draft.' using errcode = '22023';
    end if;
    v_code := nullif(v_r->>'reason_code', '');
    if v_code is not null and (public.cmo_reason_label(v_code) is null or v_r->>'verdict' <> 'down') then
      raise exception 'Pick a reason from the list, on a draft you rated down.' using errcode = '22023';
    end if;
    v_note := nullif(trim(coalesce(v_r->>'note', '')), '');
    if char_length(v_note) > 200 then
      raise exception 'A note is up to 200 characters.' using errcode = '22023';
    end if;
    begin
      insert into public.cmo_draft_ratings (user_id, item_id, version, verdict, reason_code, note, words, round)
      values (v_user, v_item.id, v_version, v_r->>'verdict', v_code, v_note, left(v_words, 3000), v_round);
    exception when unique_violation then
      raise exception 'Each version is rated once.' using errcode = '22023';
    end;
  end loop;
  v_run := public.cmo_enqueue(v_user, 'distill_ratings', jsonb_build_object('round', v_round));
  return jsonb_build_object('round', v_round, 'run_id', v_run.id);
end;
$$;

-- What the job reads: the round's ratings, with the words rated, in order.
CREATE OR REPLACE FUNCTION public.cmo_rating_round(p_user uuid, p_round uuid)
RETURNS TABLE(id uuid, item_id uuid, version smallint, verdict text, reason_code text, note text, words text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select r.id, r.item_id, r.version, r.verdict, r.reason_code, r.note, r.words
  from public.cmo_draft_ratings r where r.user_id = p_user and r.round = p_round
  order by r.created_at, r.id
$$;

-- The job's answer: up to five rules, each in 3 to 200 characters, kept as proposed corrections of the round (a rule
-- already active or waiting with the same words is skipped). The job has checked each one against the ratings.
CREATE OR REPLACE FUNCTION public.cmo_propose_rating_rules(p_user uuid, p_round uuid, p_rules text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rule text;
  v_n integer := 0;
begin
  if not exists (select 1 from public.cmo_draft_ratings where user_id = p_user and round = p_round) then
    raise exception 'No ratings in this round.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cmo_corrections:' || p_user::text, 0));
  -- A retried run writes its rules once.
  if exists (select 1 from public.cmo_corrections where user_id = p_user and round_id = p_round) then
    return 0;
  end if;
  -- The sheet shows the latest round only: rules an earlier round proposed and the founder left are set aside, so a
  -- rule proposed again belongs to this round and can still be accepted.
  update public.cmo_corrections set status = 'rejected', decided_at = now()
  where user_id = p_user and source = 'ratings' and status = 'proposed' and round_id is distinct from p_round;
  foreach v_rule in array coalesce(p_rules[1:5], '{}') loop
    v_rule := trim(coalesce(v_rule, ''));
    continue when char_length(v_rule) not between 3 and 200;
    continue when exists (select 1 from public.cmo_corrections where user_id = p_user
      and (status = 'active' or (status = 'proposed' and round_id = p_round)) and lower(rule) = lower(v_rule));
    insert into public.cmo_corrections (user_id, rule, source, round_id) values (p_user, v_rule, 'ratings', p_round);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- "Use these rules": the ticked rules of a round become active, with the founder's words; the others are set aside.
-- One transaction, no card per rule.
CREATE OR REPLACE FUNCTION public.cmo_accept_corrections(p_round uuid, p_ids uuid[], p_texts text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_n integer := coalesce(cardinality(p_ids), 0);
  v_text text;
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
    update public.cmo_corrections set status = 'active', rule = v_text, decided_at = now()
    where id = p_ids[i] and user_id = v_user and round_id = p_round and source = 'ratings' and status = 'proposed';
    if not found then
      raise exception 'This rule was already decided.' using errcode = 'P0001';
    end if;
    v_done := v_done + 1;
  end loop;
  update public.cmo_corrections set status = 'rejected', decided_at = now()
  where user_id = v_user and round_id = p_round and source = 'ratings' and status = 'proposed';
  return v_done;
end;
$$;

-- Only `cmo_rate_drafts` queues `distill_ratings` (a free Haiku call per round): a direct call is refused like the
-- schedule's own free jobs.
CREATE OR REPLACE FUNCTION public.enqueue_cmo_run(p_kind text, p_input jsonb DEFAULT '{}'::jsonb) RETURNS public.cmo_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- Posting is ordered only by Schedule, for a slot whose card the founder approved.
  -- The schedule's own jobs are free and spend provider money (the planner model, ScrapeCreators): only the schedule
  -- queues them (enqueue_cmo_run_for), never a direct call (review R5).
  if p_kind in ('publish_post', 'review_week', 'pull_metrics', 'summarize_memory', 'distill_ratings') then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  return public.cmo_enqueue(public.require_user(), p_kind, p_input);
end;
$$;

alter table public.cmo_runs drop constraint if exists cmo_runs_kind_check;
alter table public.cmo_runs add constraint cmo_runs_kind_check check (kind = any (array['onboard', 'plan_week', 'post_draft',
  'sales_scan', 'competitor_research', 'pull_metrics', 'summarize_memory', 'review_week', 'write_caption', 'write_video_brief',
  'write_slides', 'publish_post', 'niche_video_research', 'distill_ratings']));

CREATE OR REPLACE FUNCTION public.approvals_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ref_kind text := tg_argv[0];
  v_status text;
begin
  if tg_op = 'DELETE' then
    perform public.approval_close(v_ref_kind, old.id, 'cancelled');
    return old;
  end if;
  -- One branch per table: a plpgsql expression may only name fields its row has.
  if v_ref_kind = 'content_item' then
    if new.department <> 'post' then
      return new;
    end if;
    if new.status = 'in_review' then
      perform public.approval_raise(new.user_id, v_ref_kind, new.id);
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status = new.status then
      return new;
    end if;
    -- Picking an alternate as written is not an edit; changing the words is.
    v_status := case new.status
      when 'approved' then case
        when new.final_text is null or new.final_text = new.body->>'text'
          or (jsonb_typeof(new.body->'alternates') = 'array' and new.body->'alternates' ? new.final_text) then 'approved'
        else 'edited' end
      when 'published' then 'approved'
      when 'skipped' then 'skipped'
      else 'cancelled' end;
  elsif v_ref_kind = 'opportunity' then
    if new.status = 'in_review' then
      perform public.approval_raise(new.user_id, v_ref_kind, new.id);
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status = new.status then
      return new;
    end if;
    v_status := case new.status when 'replied' then 'approved' else 'skipped' end;
  elsif v_ref_kind = 'goal' then
    if new.status = 'proposed' then
      perform public.approval_raise(new.user_id, v_ref_kind, new.id);
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status = new.status then
      return new;
    end if;
    v_status := case
      when new.status <> 'approved' then 'skipped'
      when tg_op = 'UPDATE' and (new.goal is distinct from old.goal or new.target is distinct from old.target) then 'edited'
      else 'approved' end;
  else
    -- Rules from the founder's ratings (cmo-review-3 2.2) are accepted together on the rating sheet: no card each.
    if new.status = 'proposed' and new.source = 'ratings' then
      return new;
    end if;
    if new.status = 'proposed' then
      perform public.approval_raise(new.user_id, v_ref_kind, new.id);
      return new;
    end if;
    if new.source = 'ratings' and tg_op = 'UPDATE' and old.status = 'proposed' then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status = new.status then
      return new;
    end if;
    v_status := case
      when new.status <> 'active' then 'skipped'
      when tg_op = 'UPDATE' and new.rule is distinct from old.rule then 'edited'
      else 'approved' end;
  end if;
  perform public.approval_close(v_ref_kind, new.id, v_status);
  return new;
end;
$$;


CREATE OR REPLACE FUNCTION public.cmo_job_daily_limit(p_kind text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'write_video_brief' then 5 when 'write_slides' then 10 when 'publish_post' then 100 when 'niche_video_research' then 2
    -- cmo-review-3 2.2: one rating round a day (`cmo_rate_drafts`), with room for a retry.
    when 'distill_ratings' then 2
    else 0 end
$$;


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
  if exists (select 1 from public.cmo_corrections where user_id = v_o.user_id and edit_mode = v_o.edit_mode and status = 'proposed'
             and source <> 'ratings') then
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
     or (select count(*) from public.cmo_corrections where user_id = v_o.user_id and status = 'proposed' and source <> 'ratings') >= 5 then
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


revoke all on function public.cmo_rate_drafts(jsonb) from public, anon;
grant execute on function public.cmo_rate_drafts(jsonb) to authenticated;
revoke all on function public.cmo_accept_corrections(uuid, uuid[], text[]) from public, anon;
grant execute on function public.cmo_accept_corrections(uuid, uuid[], text[]) to authenticated;
revoke all on function public.cmo_rating_round(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cmo_propose_rating_rules(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.cmo_rating_round(uuid, uuid) to service_role;
grant execute on function public.cmo_propose_rating_rules(uuid, uuid, text[]) to service_role;

commit;
