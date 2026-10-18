-- How founders treat our drafts (agent evals plan, P2/P3).
--
-- One row per decided post or Reddit opportunity, written by the decide RPC in the same
-- transaction as the decision. For an approved post, `similarity` says how close the approved text
-- is to the nearest drafted version (pg_trgm, 0–1) and `chosen_version` which one it was: "approved
-- as written" is the best quality number Post has. Sales replies are posted outside the app, so
-- for them only the action is known.
--
-- No text is copied here: the founder's posts stay in `content_items`. `edit_mode` is filled in
-- later by the nightly classifier (`lib/cmo/jobs/classify-edits.ts`); near-identical approvals are
-- labelled at once. The label list is `EDIT_MODES` in `lib/cmo/jobs/edit-taxonomy.ts`.

create extension if not exists pg_trgm with schema extensions;

create table public.cmo_draft_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,
  department text not null check (department in ('post', 'sales')),
  action text not null check (action in ('approve', 'skip', 'replied', 'dismissed')),
  chosen_version smallint check (chosen_version between 0 and 2),
  similarity real check (similarity between 0 and 1),
  edit_mode text constraint cmo_draft_outcomes_edit_mode_check check (edit_mode in (
    'NO_MEANINGFUL_EDIT', 'TOO_SALESY', 'WRONG_VOICE', 'INVENTED_CLAIM',
    'TOO_LONG', 'HOOK_REWRITTEN', 'CTA_REMOVED', 'FULL_REWRITE')),
  model text not null default '' check (char_length(model) <= 100),
  prompt_version text not null default '' check (char_length(prompt_version) <= 40),
  decided_at timestamptz not null default now(),
  classified_at timestamptz,
  unique (department, item_id)
);

create index cmo_draft_outcomes_user_idx on public.cmo_draft_outcomes (user_id, decided_at desc);
create index cmo_draft_outcomes_unclassified_idx on public.cmo_draft_outcomes (decided_at)
  where classified_at is null and action = 'approve';

alter table public.cmo_draft_outcomes enable row level security;
create policy "read own draft outcomes" on public.cmo_draft_outcomes
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.cmo_draft_outcomes from anon, authenticated;
revoke all on public.cmo_draft_outcomes from anon;

-- ≥ this similarity counts as approved as written (inbox-zero uses the same 0.95 for "no meaningful
-- edit"); it is also where the classifier stops being asked.
create or replace function public.cmo_as_written() returns real
language sql immutable as $$ select 0.95::real $$;

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

  if p_action = 'skip' then
    update public.content_items set status = 'skipped', decided_at = now(), updated_at = now()
    where id = p_id returning * into v_row;
    if p_reason is not null and char_length(trim(p_reason)) > 0 then
      insert into public.cmo_memories (user_id, type, body)
      values (v_user, 'feedback', left('Skipped the X post "' || left(v_row.idea, 120) || '": ' || trim(p_reason), 600));
    end if;
    insert into public.cmo_draft_outcomes (user_id, item_id, department, action, model, prompt_version)
    values (v_user, p_id, 'post', 'skip', left(coalesce(v_row.body->'gen'->>'model', ''), 100),
            left(coalesce(v_row.body->'gen'->>'prompt_version', ''), 40))
    on conflict (department, item_id) do nothing;
    return v_row;
  end if;

  v_text := coalesce(nullif(trim(p_text), ''), v_row.body->>'text');
  if v_text is null or char_length(v_text) = 0 then
    raise exception 'This post is empty.' using errcode = '22023';
  end if;
  if char_length(v_text) > 280 then
    raise exception 'Posts on X can be at most 280 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.operation_log
      where user_id = v_user and platform = 'x' and action = 'approve' and at > now() - interval '1 day') >= 5 then
    raise exception 'You can approve 5 posts for X a day. Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.operation_log (user_id, platform, action, target) values (v_user, 'x', 'approve', p_id::text);
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
  insert into public.cmo_draft_outcomes (
    user_id, item_id, department, action, chosen_version, similarity, edit_mode, classified_at, model, prompt_version
  ) values (
    v_user, p_id, 'post', 'approve', v_best_index, v_best,
    case when v_best >= public.cmo_as_written() then 'NO_MEANINGFUL_EDIT' end,
    case when v_best >= public.cmo_as_written() then now() end,
    left(coalesce(v_row.body->'gen'->>'model', ''), 100), left(coalesce(v_row.body->'gen'->>'prompt_version', ''), 40)
  )
  on conflict (department, item_id) do nothing;
  return v_row;
end;
$$;

create or replace function public.cmo_decide_opportunity(p_id uuid, p_action text, p_reason text default null)
returns public.opportunities
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.require_user();
  v_row public.opportunities;
begin
  if p_action is null or p_action not in ('replied', 'dismissed') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  update public.opportunities set status = p_action, decided_at = now()
  where id = p_id and user_id = v_user and status = 'in_review'
  returning * into v_row;
  if not found then
    if exists(select 1 from public.opportunities where id = p_id and user_id = v_user) then
      raise exception 'This conversation was already decided.' using errcode = 'P0001';
    end if;
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  if p_action = 'dismissed' and p_reason is not null and char_length(trim(p_reason)) > 0 then
    insert into public.cmo_memories (user_id, type, body)
    values (v_user, 'feedback', left('Dismissed the Reddit thread "' || left(v_row.title, 120) || '": ' || trim(p_reason), 600));
  end if;
  insert into public.cmo_draft_outcomes (user_id, item_id, department, action, model, prompt_version)
  values (v_user, p_id, 'sales', p_action, left(coalesce(v_row.gen->>'model', ''), 100), left(coalesce(v_row.gen->>'prompt_version', ''), 40))
  on conflict (department, item_id) do nothing;
  return v_row;
end;
$$;

-- Weekly draft quality for the owner (service role only): split by model and prompt so a model or
-- prompt change shows up as its own rows.
create view public.cmo_draft_quality_weekly with (security_invoker = true) as
with modes as (
  select date_trunc('week', decided_at)::date as week, department, model, prompt_version, edit_mode, count(*) as n
  from public.cmo_draft_outcomes
  where edit_mode is not null
  group by 1, 2, 3, 4, 5
), totals as (
  select date_trunc('week', decided_at)::date as week, department, model, prompt_version,
    count(*) as decided,
    count(*) filter (where action = 'approve' and similarity >= public.cmo_as_written()) as approved_as_written,
    count(*) filter (where action = 'approve' and similarity < public.cmo_as_written()) as approved_edited,
    count(*) filter (where action = 'replied') as replied,
    count(*) filter (where action in ('skip', 'dismissed')) as skipped,
    round(avg(similarity)::numeric, 3) as mean_similarity
  from public.cmo_draft_outcomes
  group by 1, 2, 3, 4
)
select t.*, coalesce((
  select jsonb_object_agg(m.edit_mode, m.n) from modes m
  where m.week = t.week and m.department = t.department and m.model = t.model and m.prompt_version = t.prompt_version
), '{}'::jsonb) as edit_modes
from totals t;

revoke all on public.cmo_draft_quality_weekly from public, anon, authenticated;
grant select on public.cmo_draft_quality_weekly to service_role;
revoke all on function public.cmo_as_written() from public, anon;
