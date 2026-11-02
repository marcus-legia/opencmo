-- 20261228090000: P2 A0, the contracts Studio joins the brain on (docs/plans/cmo/2026-10-28-p2-studio-brain-plan.md
-- §3, §5; sessions/A.md A0).
--
-- Skeleton only: the tables, their grants and RLS, and what an approval card shows of each new row. Nothing raises
-- these cards yet and `approval_decide` still refuses them: the RPCs that write the rows and decide the cards come in
-- A1 (`studio_step_raise`, `approval_decide` cases) and A3 (`mark_finished`, the event rules).
--
-- - `studio_steps`: one priced step of the Video team (keyframes, shots, a redone keyframe) waiting on the founder.
--   `card` is what the adapter's `plan` returned for the card (`lib/departments/studio`); the snapshot reads only the
--   named fields below, so the hash covers exactly what the founder sees and nothing the adapter adds later.
-- - `short_batches` and `shorts`: three shorts cut from one finished edit, approved together. A short is its own edit
--   (a `clips` row of kind `short` pointing at its parent), so adding shorts never edits the finished document.
-- - `editor_projects.finished_at` / `finished_hash`: the edit was marked finished at that document hash; any later
--   edit clears it (A3), and shorts are cut only from a finished edit.
--
-- Snapshots hold storage paths and ids, never signed URLs: a URL changes on every read and would change the hash.

begin;

-- A short is an edit of its own, cut from a parent edit. The parent may be deleted later; the short stays.
alter table public.clips drop constraint clips_kind_check;
alter table public.clips add constraint clips_kind_check check (kind in ('full', 'blank', 'short'));
alter table public.clips add column parent_clip_id uuid references public.clips(id) on delete set null;
alter table public.clips add constraint clips_parent_short_check check (parent_clip_id is null or kind = 'short');
create index clips_parent_idx on public.clips (parent_clip_id) where parent_clip_id is not null;

alter table public.editor_projects add column finished_at timestamptz;
alter table public.editor_projects add column finished_hash text check (finished_hash ~ '^[0-9a-f]{64}$');
alter table public.editor_projects add constraint editor_projects_finished_check
  check ((finished_at is null) = (finished_hash is null));

create table public.studio_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clip_id uuid not null references public.clips(id) on delete cascade,
  -- The Studio entry point the step runs (`create_video`, `animate_video`, `redo_keyframe`…); the registry lists them.
  tool text not null check (tool ~ '^[a-z_]{1,40}$'),
  -- Which card it raises: `script` (storyboard + keyframe price) or `price` (contact sheet or shots + video price).
  kind text not null check (kind in ('script', 'price')),
  -- What `decide` runs once approved: the adapter's prepared input. Never shown, so never hashed.
  input jsonb not null check (jsonb_typeof(input) = 'object' and octet_length(input::text) <= 65536),
  card jsonb not null check (jsonb_typeof(card) = 'object' and octet_length(card::text) <= 32768),
  price_credits integer not null check (price_credits >= 0),
  status text not null default 'waiting'
    check (status in ('waiting', 'approved', 'running', 'done', 'cancelled', 'failed')),
  order_id uuid references public.work_orders(id) on delete set null,
  -- Redo one keyframe: the new step points at the one it replaces, and the order keeps waiting.
  redo_of uuid references public.studio_steps(id) on delete set null,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index studio_steps_user_idx on public.studio_steps (user_id, status, created_at);
create index studio_steps_clip_idx on public.studio_steps (clip_id);
create index studio_steps_order_idx on public.studio_steps (order_id) where order_id is not null;

create table public.short_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_clip_id uuid not null references public.clips(id) on delete cascade,
  -- The document hash the parent was finished at when the batch was cut.
  parent_hash text not null check (parent_hash ~ '^[0-9a-f]{64}$'),
  order_id uuid references public.work_orders(id) on delete set null,
  status text not null default 'picking'
    check (status in ('picking', 'building', 'rendering', 'waiting_founder', 'approved', 'sent_back', 'failed', 'cancelled')),
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index short_batches_user_idx on public.short_batches (user_id, status, created_at);
create index short_batches_parent_idx on public.short_batches (parent_clip_id);

create table public.shorts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.short_batches(id) on delete cascade,
  parent_clip_id uuid references public.clips(id) on delete set null,
  -- Null until the Builder made the short's own edit.
  short_clip_id uuid unique references public.clips(id) on delete set null,
  -- Seconds on the parent's timeline. The reviewer holds 15–60 s per platform; this only stops nonsense.
  source_start numeric not null check (source_start >= 0),
  source_end numeric not null,
  hook text not null check (char_length(hook) between 1 and 120),
  reason text not null check (char_length(reason) between 1 and 300),
  status text not null default 'building'
    check (status in ('building', 'rendering', 'ready', 'approved', 'sent_back', 'failed')),
  created_at timestamptz not null default now(),
  check (source_end > source_start and source_end - source_start <= 180)
);
create index shorts_batch_idx on public.shorts (batch_id);
create index shorts_user_idx on public.shorts (user_id, created_at);

alter table public.studio_steps enable row level security;
alter table public.short_batches enable row level security;
alter table public.shorts enable row level security;
create policy "read own studio steps" on public.studio_steps for select to authenticated using (user_id = (select auth.uid()));
create policy "read own short batches" on public.short_batches for select to authenticated using (user_id = (select auth.uid()));
create policy "read own shorts" on public.shorts for select to authenticated using (user_id = (select auth.uid()));
-- Founders read; every write goes through an RPC (A1, A3) or the service role (the brain's runner).
revoke all on public.studio_steps, public.short_batches, public.shorts from anon, authenticated;
grant select on public.studio_steps, public.short_batches, public.shorts to authenticated;
grant select, insert, update, delete on public.studio_steps, public.short_batches, public.shorts to service_role;
alter publication supabase_realtime add table public.studio_steps, public.short_batches, public.shorts;

alter table public.approvals drop constraint approvals_ref_kind_check;
alter table public.approvals add constraint approvals_ref_kind_check check (ref_kind in ('content_item', 'opportunity', 'goal',
  'correction', 'studio_step', 'editor_project', 'short_batch'));

-- Same as 20261227100000 plus the three Studio sources. The shapes are `StudioStepSnapshot`,
-- `FinishedVideoSnapshot` and `ShortsBatchSnapshot` in apps/web/lib/screens/approval-card.ts; change both together.
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
      into v from public.cmo_corrections where id = p_ref_id;
    when 'studio_step' then
      -- Card 1 (`script`): the storyboard and the keyframe price. Card 2 and a redone keyframe (`price`): the
      -- keyframes (contact sheet) or the shots, the wait and the exact price.
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
      -- The finished-video card shows the render of the document as it is now; a render of an older document is
      -- not this video, so it shows none.
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
          from public.shorts s where s.batch_id = b.id), '[]'::jsonb))
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

-- Same as 20261227100000; Studio's cards are raised by Studio.
create or replace function public.approval_raise(p_user uuid, p_ref_kind text, p_ref_id uuid)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_snapshot jsonb := public.approval_snapshot(p_ref_kind, p_ref_id);
  v_hash text;
  v_kind text;
begin
  if v_snapshot is null then
    return;
  end if;
  v_hash := public.approval_hash(v_snapshot);
  if exists (select 1 from public.approvals
             where ref_kind = p_ref_kind and ref_id = p_ref_id and status = 'waiting' and content_hash = v_hash) then
    return;
  end if;
  update public.approvals set status = 'cancelled', decided_at = now()
  where ref_kind = p_ref_kind and ref_id = p_ref_id and status = 'waiting';
  v_kind := v_snapshot->>'kind';
  insert into public.approvals (user_id, kind, department, ref_kind, ref_id, snapshot, content_hash, price_credits)
  values (p_user, v_kind,
    case v_kind when 'post' then 'writer' when 'reply' then 'sales'
      when 'script' then 'studio' when 'price' then 'studio' when 'finished_video' then 'studio'
      when 'shorts_batch' then 'studio' else 'brain' end,
    p_ref_kind, p_ref_id, v_snapshot, v_hash,
    case when v_kind in ('script', 'price') then (v_snapshot->>'price_credits')::integer end);
end;
$$;
revoke all on function public.approval_raise(uuid, text, uuid) from public, anon, authenticated;

commit;
