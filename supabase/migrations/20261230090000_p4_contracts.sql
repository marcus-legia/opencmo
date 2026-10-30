-- 20261230090000: P4 A0, the contracts of Schedule and Publish (docs/plans/cmo/2026-10-28-p4-schedule-publish-plan.md,
-- docs/architecture/schedule-publish.md §5–§6, approval.md §5–§6).
--
-- Skeleton only: the tables, their grants and RLS, the account RPCs the connect routes (B2) write through, and what
-- a schedule card shows. Nothing proposes, fires or confirms a slot yet (A1, A2).
--
-- Tokens of the founder's platforms never come here: Zernio keeps them, we keep Zernio's profile and account ids.
-- The `publish_media` task kind lands with its worker handler (B4), because the kind list, the CHECK and an importable
-- handler must change together (task-kinds.check.ts, test_task_kinds.py).

begin;

-- One Zernio profile per founder; every account they connect hangs off it.
create table public.zernio_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  zernio_profile_id text not null unique check (char_length(zernio_profile_id) between 1 and 100),
  created_at timestamptz not null default now()
);

-- One account per platform and founder: the adapter never posts from several accounts on one platform.
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'zernio' check (provider = 'zernio'),
  platform text not null check (platform in ('x', 'threads', 'linkedin', 'tiktok', 'youtube', 'instagram')),
  handle text not null check (char_length(handle) between 1 and 100),
  avatar_url text check (avatar_url ~ '^https://' and char_length(avatar_url) <= 1000),
  zernio_account_id text not null unique check (char_length(zernio_account_id) between 1 and 100),
  -- `error`: Zernio says the platform refuses it (token revoked, permissions changed); the founder reconnects.
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

-- A time for one approved deliverable on one platform (schedule-publish.md §5).
create table public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  platform text not null check (platform in ('x', 'threads', 'linkedin', 'tiktok', 'youtube', 'instagram')),
  -- Null: no connected account for the platform, so the card falls back to copy and open (`mode = 'intent'`).
  account_id uuid references public.social_accounts(id) on delete set null,
  mode text not null default 'publish' check (mode in ('publish', 'intent')),
  publish_at timestamptz not null,
  -- Natural posting: the slot fires up to four minutes either side of the approved time (owner, 2026-10-26).
  jitter_seconds integer not null default 0 check (jitter_seconds between -240 and 240),
  -- Past this the slot is `missed` and never posts late.
  window_ends_at timestamptz not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published', 'missed', 'failed', 'cancelled')),
  approval_id uuid references public.approvals(id) on delete set null,
  -- The platform's own fields the card shows (TikTok privacy, comment/duet/stitch) and the AI-generated label.
  options jsonb not null default '{}'::jsonb
    check (jsonb_typeof(options) = 'object' and octet_length(options::text) <= 1024),
  -- Sent to Zernio with every attempt for this slot, so a retry never posts twice.
  idempotency_key text not null unique default gen_random_uuid()::text,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  external_id text check (char_length(external_id) <= 200),
  external_url text check (external_url ~ '^https://' and char_length(external_url) <= 1000),
  error jsonb check (error is null or (jsonb_typeof(error) = 'object' and error ? 'message' and octet_length(error::text) <= 2048)),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_ends_at > publish_at)
);
-- Never twice: one live slot per deliverable and platform. A missed, failed or cancelled slot frees it for a new one.
create unique index schedule_slots_one_live on public.schedule_slots (deliverable_id, platform)
  where status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published');
create index schedule_slots_user_idx on public.schedule_slots (user_id, publish_at);
create index schedule_slots_due_idx on public.schedule_slots (publish_at) where status = 'waiting';

-- Zernio webhook events already handled; a replay finds its id here and is refused (like Polar's receipts).
create table public.zernio_receipts (
  event_id text primary key check (char_length(event_id) between 1 and 200),
  received_at timestamptz not null default now()
);

alter table public.zernio_profiles enable row level security;
alter table public.social_accounts enable row level security;
alter table public.schedule_slots enable row level security;
alter table public.zernio_receipts enable row level security;
create policy "read own zernio profile" on public.zernio_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "read own social accounts" on public.social_accounts for select to authenticated using (user_id = (select auth.uid()));
create policy "read own schedule slots" on public.schedule_slots for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.zernio_profiles, public.social_accounts, public.schedule_slots, public.zernio_receipts from anon, authenticated;
grant select on public.zernio_profiles, public.social_accounts, public.schedule_slots to authenticated;
grant select, insert, update, delete on public.zernio_profiles, public.social_accounts, public.schedule_slots,
  public.zernio_receipts to service_role;
alter publication supabase_realtime add table public.social_accounts, public.schedule_slots;

alter table public.approvals drop constraint approvals_ref_kind_check;
alter table public.approvals add constraint approvals_ref_kind_check check (ref_kind in ('content_item', 'opportunity', 'goal',
  'correction', 'studio_step', 'editor_project', 'short_batch', 'schedule_slot'));

-- The founder's Zernio profile, created by the connect route (service role) the first time they connect.
create or replace function public.zernio_profile_save(p_user uuid, p_profile text)
returns void language plpgsql volatile security definer set search_path = public
as $$
begin
  insert into public.zernio_profiles (user_id, zernio_profile_id) values (p_user, p_profile)
  on conflict (user_id) do nothing;
  if not exists (select 1 from public.zernio_profiles where user_id = p_user and zernio_profile_id = p_profile) then
    raise exception 'This founder already has another Zernio profile.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.zernio_profile_save(uuid, text) from public, anon, authenticated;
grant execute on function public.zernio_profile_save(uuid, text) to service_role;

-- An account Zernio confirmed belongs to this founder's profile. Service role only: a founder calling it directly
-- could name an account id that is not theirs, so the callback route checks it with Zernio first.
create or replace function public.social_account_save(p_user uuid, p_platform text, p_handle text, p_avatar_url text,
  p_zernio_account_id text)
returns public.social_accounts language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.social_accounts;
begin
  if not exists (select 1 from public.zernio_profiles where user_id = p_user) then
    raise exception 'Connect starts with a Zernio profile.' using errcode = 'P0001';
  end if;
  insert into public.social_accounts (user_id, platform, handle, avatar_url, zernio_account_id)
  values (p_user, p_platform, left(trim(p_handle), 100), nullif(trim(coalesce(p_avatar_url, '')), ''), p_zernio_account_id)
  on conflict (user_id, platform) do update
    set handle = excluded.handle, avatar_url = excluded.avatar_url, zernio_account_id = excluded.zernio_account_id,
        status = 'connected', connected_at = case when social_accounts.zernio_account_id = excluded.zernio_account_id
          then social_accounts.connected_at else now() end,
        updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.social_account_save(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.social_account_save(uuid, text, text, text, text) to service_role;

-- The founder disconnects an account. The route removes it at Zernio first, then here; slots that pointed at it
-- lose their account and their cards change, so nothing can post to it any more.
create or replace function public.social_account_remove(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  delete from public.social_accounts where id = p_id and user_id = v_user;
  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.social_account_remove(uuid) from public, anon, authenticated;
grant execute on function public.social_account_remove(uuid) to authenticated, service_role;

-- What goes out on one platform for one deliverable: a post's words, or an edit with its caption for that platform.
-- `content_hash` covers exactly that, so editing the words or the video after approving supersedes the card.
create or replace function public.schedule_content(p_deliverable uuid, p_platform text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_d public.deliverables;
  v_text text;
  v_title text;
  v_doc text;
begin
  select * into v_d from public.deliverables where id = p_deliverable;
  if not found then
    return null;
  end if;
  if v_d.ref_kind = 'content_item' then
    select coalesce(body->>'text', '') into v_text from public.content_items where id = v_d.ref_id;
    return jsonb_build_object('clip_id', null, 'text', v_text, 'title', null,
      'content_hash', public.approval_hash(jsonb_build_object('text', v_text)));
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
revoke all on function public.schedule_content(uuid, text) from public, anon, authenticated;

create or replace function public.approval_snapshot(p_ref_kind text, p_ref_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
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
revoke all on function public.approval_snapshot(text, uuid) from public, anon, authenticated;

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
  -- A schedule card carries its time and account in the foot and expires when its time comes (rule 4).
  insert into public.approvals (user_id, kind, department, ref_kind, ref_id, snapshot, content_hash, price_credits,
    post_at, account, expires_at)
  values (p_user, v_kind,
    case v_kind when 'post' then 'writer' when 'reply' then 'sales'
      when 'script' then 'studio' when 'price' then 'studio' when 'finished_video' then 'studio'
      when 'shorts_batch' then 'studio' when 'schedule' then 'schedule' else 'brain' end,
    p_ref_kind, p_ref_id, v_snapshot, v_hash,
    case when v_kind in ('script', 'price') then (v_snapshot->>'price_credits')::integer end,
    case when v_kind = 'schedule' then (v_snapshot->>'publish_at')::timestamptz end,
    case when v_kind = 'schedule' then left(v_snapshot->>'handle', 100) end,
    case when v_kind = 'schedule' then (v_snapshot->>'publish_at')::timestamptz end);
end;
$$;
revoke all on function public.approval_raise(uuid, text, uuid) from public, anon, authenticated;

commit;
