-- Repurpose on demand (owner, 2026-11-12, daily core drafts D4).
--
-- One core post serves every platform the planner picked. A founder who wants one platform to read differently
-- presses "Rewrite for LinkedIn" on the post's card: one paid rewrite, for that platform only. The rewrite is a
-- variant of the post. Its slot on that platform posts the variant; every other slot posts the core text.
--
-- A variant belongs to the words it was written from: `source_hash` is the core text's hash, and a variant whose
-- post was edited since is ignored (the core text goes out) until the founder asks for a new one.
--
-- Nothing goes out unseen: a slot that takes a variant never rides on the post card's approval. It gets its own
-- schedule card with the rewrite on it, and a slot already approved goes back to the founder when a variant lands.

create table if not exists public.post_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.content_items (id) on delete cascade,
  platform text not null,
  text text not null,
  source_hash text not null,
  run_id uuid,
  gen jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_variants_platform_check check (platform in ('x', 'threads', 'linkedin', 'facebook')),
  constraint post_variants_text_check check (char_length(text) between 1 and 25000),
  constraint post_variants_gen_check check (jsonb_typeof(gen) = 'object' and octet_length(gen::text) <= 1024),
  constraint post_variants_item_platform_key unique (item_id, platform)
);
create index if not exists post_variants_user_idx on public.post_variants (user_id);

alter table public.post_variants enable row level security;
drop policy if exists "read own post variants" on public.post_variants;
create policy "read own post variants" on public.post_variants for select to authenticated
  using (user_id = (select auth.uid()));

-- Writes go through the runner's RPC only.
revoke all on public.post_variants from public, anon, authenticated;
grant select on public.post_variants to authenticated;
grant select, insert, update, delete on public.post_variants to service_role;

-- The hash a variant is tied to: the core text as it was when the rewrite was written.
create or replace function public.post_core_hash(p_text text) returns text
language sql immutable
set search_path = public
as $$ select md5(coalesce(p_text, '')) $$;

-- The rewrite that goes out on a platform, or null when the core text does: no variant, or one written from words
-- the founder has since changed.
create or replace function public.post_variant_text(p_item uuid, p_platform text) returns text
language sql
stable
security definer
set search_path = public
as $$
  select v.text from public.post_variants v join public.content_items c on c.id = v.item_id
  where v.item_id = p_item and v.platform = p_platform and c.user_id = v.user_id
    and v.source_hash = public.post_core_hash(c.body->>'text') and public.thread_valid(c.body) is not true;
$$;

-- A variant landed (or was replaced): the post's slot on that platform now carries other words. One still proposed
-- gets a new card; one already approved goes back to the founder. Nothing posts a rewrite they did not see.
create or replace function public.schedule_variant_changed(p_item uuid, p_platform text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.schedule_slots;
begin
  for v_slot in
    select s.* from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
    where d.ref_kind = 'content_item' and d.ref_id = p_item and s.platform = p_platform and s.status in ('proposed', 'waiting')
    for update of s
  loop
    if v_slot.status = 'waiting' then
      update public.schedule_slots set status = 'proposed', updated_at = now() where id = v_slot.id;
    end if;
    perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
  end loop;
end;
$$;

-- The platforms a post goes to: the planner's targets when the post has them, else its one platform.
create or replace function public.post_variant_platforms(p_item public.content_items) returns text[]
language sql
stable
set search_path = public
as $$
  select case when jsonb_typeof(p_item.body->'targets') = 'array' and jsonb_array_length(p_item.body->'targets') > 0
    then array(select jsonb_array_elements_text(p_item.body->'targets'))
    else array[public.platform_profile_id(p_item.platform)] end;
$$;

-- Writer saves one platform's rewrite (the runner, with the service role). The post must still be the founder's to
-- change and the rewrite must fit the platform; a new rewrite replaces the old one.
create or replace function public.cmo_save_variant(p_user uuid, p_run uuid, p_item uuid, p_platform text, p_text text,
  p_gen jsonb default '{}'::jsonb)
returns public.post_variants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.content_items;
  v_text text := btrim(coalesce(p_text, ''), E' \t\n\r');
  v_limit integer := (public.platform_profile(p_platform)->>'limit')::integer;
  v_row public.post_variants;
begin
  if not exists (select 1 from public.cmo_runs r where r.id = p_run and r.user_id = p_user and r.kind = 'repurpose_post') then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  select * into v_item from public.content_items
  where id = p_item and user_id = p_user and department = 'post' for update;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if v_item.status not in ('in_review', 'approved') then
    raise exception 'This post can no longer be rewritten.' using errcode = 'P0001';
  end if;
  if public.thread_valid(v_item.body) then
    raise exception 'A thread cannot be rewritten for another platform.' using errcode = 'P0001';
  end if;
  if public.platform_profile(p_platform)->>'kind' is distinct from 'post' or v_limit is null
     or not (p_platform = any (public.post_variant_platforms(v_item))) then
    raise exception 'This post does not go to that platform.' using errcode = '22023';
  end if;
  if v_text = '' or char_length(v_text) > least(v_limit, 25000) then
    raise exception 'The rewrite must be between 1 and % characters.', least(v_limit, 25000) using errcode = '22023';
  end if;
  if p_gen is not null and (jsonb_typeof(p_gen) <> 'object' or octet_length(p_gen::text) > 1024) then
    raise exception 'This rewrite is not valid.' using errcode = '22023';
  end if;
  insert into public.post_variants (user_id, item_id, platform, text, source_hash, run_id, gen)
  values (p_user, p_item, p_platform, v_text, public.post_core_hash(v_item.body->>'text'), p_run, coalesce(p_gen, '{}'::jsonb))
  on conflict (item_id, platform) do update
  set text = excluded.text, source_hash = excluded.source_hash, run_id = excluded.run_id, gen = excluded.gen, updated_at = now()
  returning * into v_row;
  perform public.schedule_variant_changed(p_item, p_platform);
  return v_row;
end;
$$;

-- The founder's button: "Rewrite for <platform>". The price is held here, before the model runs (`cmo_enqueue`); a
-- second press while the first rewrite is being written answers with the same run and holds nothing more.
create or replace function public.repurpose_post(p_item uuid, p_platform text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_item public.content_items;
  v_run public.cmo_runs;
begin
  select * into v_item from public.content_items where id = p_item and user_id = v_user and department = 'post';
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if v_item.status not in ('in_review', 'approved') then
    raise exception 'This post can no longer be rewritten.' using errcode = 'P0001';
  end if;
  if public.thread_valid(v_item.body) then
    raise exception 'A thread cannot be rewritten for another platform.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(v_item.body->>'text'), '') = '' then
    raise exception 'This post has no text to rewrite.' using errcode = 'P0001';
  end if;
  if p_platform is null or public.platform_profile(p_platform)->>'kind' is distinct from 'post'
     or not (p_platform = any (public.post_variant_platforms(v_item))) then
    raise exception 'This post does not go to that platform.' using errcode = '22023';
  end if;
  v_run := public.cmo_enqueue(v_user, 'repurpose_post', jsonb_build_object('item_id', v_item.id, 'platform', p_platform));
  return jsonb_build_object('run_id', v_run.id, 'status', v_run.status, 'credits', v_run.credits, 'item_id', v_item.id,
    'platform', p_platform);
end;
$$;

-- The new job: one credit, like a draft; twenty a day is room for every post of a busy day and a few second tries.
alter table public.cmo_runs drop constraint if exists cmo_runs_kind_check;
alter table public.cmo_runs add constraint cmo_runs_kind_check check (kind = any (array['onboard', 'plan_week', 'post_draft',
  'sales_scan', 'competitor_research', 'pull_metrics', 'summarize_memory', 'review_week', 'write_caption', 'write_video_brief',
  'write_slides', 'publish_post', 'niche_video_research', 'distill_ratings', 'repurpose_post']));

create or replace function public.cmo_job_price(p_kind text) returns integer
language sql immutable as $$
  select case p_kind when 'plan_week' then 1 when 'post_draft' then 1 when 'sales_scan' then 5
    when 'competitor_research' then 2 when 'pull_metrics' then 0 when 'summarize_memory' then 0 when 'review_week' then 0
    when 'write_caption' then 1 when 'write_video_brief' then 1 when 'write_slides' then 1 when 'publish_post' then 0 when 'niche_video_research' then 2
    when 'repurpose_post' then 1
    else 0 end
$$;

create or replace function public.cmo_job_daily_limit(p_kind text) returns integer
language sql immutable as $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'write_video_brief' then 5 when 'write_slides' then 10 when 'publish_post' then 100 when 'niche_video_research' then 2
    -- cmo-review-3 2.2: one rating round a day (`cmo_rate_drafts`), with room for a retry.
    when 'distill_ratings' then 2
    when 'repurpose_post' then 20
    else 0 end
$$;

-- A rewrite is ordered only through `repurpose_post`, which checks the post is the founder's and goes to the platform.
create or replace function public.enqueue_cmo_run(p_kind text, p_input jsonb default '{}'::jsonb) returns public.cmo_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Posting is ordered only by Schedule, for a slot whose card the founder approved.
  -- The schedule's own jobs are free and spend provider money (the planner model, ScrapeCreators): only the schedule
  -- queues them (enqueue_cmo_run_for), never a direct call (review R5).
  if p_kind in ('publish_post', 'review_week', 'pull_metrics', 'summarize_memory', 'distill_ratings', 'repurpose_post') then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  return public.cmo_enqueue(public.require_user(), p_kind, p_input);
end;
$$;

-- What a slot posts: the platform's variant when the post has a current one, else the core text.
create or replace function public.schedule_content(p_deliverable uuid, p_platform text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_d public.deliverables;
  v_text text;
  v_title text;
  v_doc text;
  v_image_clip uuid;
  v_image jsonb;
  v_thread jsonb;
  v_variant text;
begin
  select * into v_d from public.deliverables where id = p_deliverable;
  if not found then
    return null;
  end if;
  if v_d.ref_kind = 'content_item' then
    select coalesce(body->>'text', ''), case when public.thread_valid(body) then body->'thread' end
    into v_text, v_thread from public.content_items where id = v_d.ref_id;
    -- The founder had the post rewritten for this platform: its slot there carries the rewrite, the others the core.
    v_variant := public.post_variant_text(v_d.ref_id, p_platform);
    if v_variant is not null then
      v_text := v_variant;
      v_thread := null;
    end if;
    -- The post's newest image (P5 B4), as its cover still of the image's document as it is now. Only a post with an
    -- image carries the key, so the hash of a post without one is what it was before P5.
    select i.ref_id into v_image_clip from public.deliverables i
    where i.post_id = v_d.ref_id and i.kind = 'image' order by i.created_at desc limit 1;
    if v_image_clip is not null then
      select jsonb_build_object('clip_id', v_image_clip,
          'object', t.output->'stills'->coalesce((t.output->>'cover_index')::integer, 0)->>'object',
          'bytes', t.output->'stills'->coalesce((t.output->>'cover_index')::integer, 0)->'bytes')
        into v_image
      from public.tasks t join public.editor_projects p on p.clip_id = t.clip_id
      where t.clip_id = v_image_clip and t.kind = 'render_stills' and t.status = 'done'
        and t.settings_hash = public.editor_document_hash(p.document)
      order by t.finished_at desc nulls last limit 1;
      if v_image->>'object' is null then
        v_image := null;
      end if;
    end if;
    return jsonb_build_object('clip_id', null, 'text', v_text, 'title', null,
      'content_hash', public.approval_hash(jsonb_build_object('text', v_text)
        || case when v_image is not null then jsonb_build_object('image', v_image->>'object') else '{}'::jsonb end
        || case when v_thread is not null then jsonb_build_object('thread', v_thread) else '{}'::jsonb end))
      || case when v_image is not null then jsonb_build_object('image', v_image) else '{}'::jsonb end
      || case when v_thread is not null then jsonb_build_object('thread', v_thread) else '{}'::jsonb end;
  elsif v_d.ref_kind = 'clip' then
    select public.editor_document_hash(document) into v_doc from public.editor_projects where clip_id = v_d.ref_id;
    select body->>'text', body->>'title' into v_text, v_title
    from public.content_items
    where clip_id = v_d.ref_id and department = 'video' and platform = public.platform_profile_id(p_platform)
      and status in ('approved', 'published');
    return jsonb_build_object('clip_id', v_d.ref_id, 'text', v_text, 'title', v_title,
      'content_hash', public.approval_hash(jsonb_strip_nulls(jsonb_build_object('document_hash', v_doc, 'text', v_text,
        'title', v_title))));
  end if;
  return null;
end;
$$;

revoke all on function public.post_core_hash(text) from public, anon, authenticated;
revoke all on function public.post_variant_text(uuid, text) from public, anon, authenticated;
revoke all on function public.schedule_variant_changed(uuid, text) from public, anon, authenticated;
revoke all on function public.post_variant_platforms(public.content_items) from public, anon, authenticated;
revoke all on function public.cmo_save_variant(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.repurpose_post(uuid, text) from public, anon;
revoke all on function public.schedule_content(uuid, text) from public, anon, authenticated;
grant execute on function public.cmo_save_variant(uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.repurpose_post(uuid, text) to authenticated;
