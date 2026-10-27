-- 20261227100000: approval A0, one approvals table and one decide RPC (docs/architecture/approval.md §4, §11;
-- brain plan W1-2).
--
-- Every card the founder decides is one row here, whatever raised it. In wave 1 the rows mirror the four kinds
-- that already exist: X posts (`content_items` in review), Reddit replies (`opportunities` in review), weekly goals
-- (`cmo_goals` proposed) and rules from edits (`cmo_corrections` proposed). Triggers on those tables keep the
-- mirror exact, so every write path that exists today (jobs, chat, MCP, the old decide RPCs) raises, supersedes
-- and closes cards without knowing about this table.
--
-- The snapshot is what the card shows; `content_hash` is the sha256 of its JCS form. `approval_decide` refuses a
-- card whose hash is not the one the founder saw, so the founder approves exactly what was on screen (rule 1).
-- The decision itself still runs in the existing RPC (owner check, locks, daily caps, outcomes): nothing changes
-- for the founder.

begin;

-- RFC 8785 (JCS) for the values snapshots hold: objects, arrays, strings, booleans, null and integers. Keys sort
-- by UTF-8 bytes (`collate "C"`), which matches JCS's UTF-16 order outside the astral planes; a jsonb number keeps
-- its written form, so snapshots never store fractions. Same output as `canonicalJson` in lib/settings-schema.ts.
create or replace function public.jcs(p jsonb) returns text
language plpgsql immutable strict set search_path = public
as $$
begin
  case jsonb_typeof(p)
    when 'object' then
      return '{' || coalesce((
        select string_agg(to_jsonb(k)::text || ':' || public.jcs(v), ',' order by k collate "C")
        from jsonb_each(p) as e(k, v)), '') || '}';
    when 'array' then
      return '[' || coalesce((
        select string_agg(public.jcs(v), ',' order by i)
        from jsonb_array_elements(p) with ordinality as a(v, i)), '') || ']';
    else
      return p::text;
  end case;
end;
$$;
revoke all on function public.jcs(jsonb) from public, anon, authenticated;

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('post', 'reply', 'goal', 'script', 'price', 'finished_video', 'shorts_batch',
    'slideshow', 'schedule', 'correction')),
  department text not null check (department in ('brain', 'research', 'writer', 'studio', 'sales', 'schedule', 'publish')),
  -- The row the card decides. No foreign key: one column points at four tables (more in A1).
  ref_kind text not null check (ref_kind in ('content_item', 'opportunity', 'goal', 'correction')),
  ref_id uuid not null,
  -- `cancelled` also covers a card superseded by a newer snapshot of the same row.
  status text not null default 'waiting'
    check (status in ('waiting', 'approved', 'edited', 'skipped', 'expired', 'cancelled')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 32768),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  price_credits integer check (price_credits >= 0),
  post_at timestamptz,
  account text check (char_length(account) <= 100),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  -- Email and push only open a card (rule 5); they are here for the record of where a reminder led.
  decided_via text check (decided_via in ('app', 'email', 'push', 'mcp'))
);
create unique index approvals_one_waiting on public.approvals (ref_kind, ref_id) where status = 'waiting';
create index approvals_user_idx on public.approvals (user_id, status, created_at);
alter table public.approvals enable row level security;
create policy "read own approvals" on public.approvals
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.approvals from anon, authenticated;
grant select on public.approvals to authenticated;
grant select, insert, update, delete on public.approvals to service_role;
alter publication supabase_realtime add table public.approvals;

-- What a card shows of its row; the same function raises the card and checks it before a decision.
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
    else
      raise exception 'Unknown card source.' using errcode = '22023';
  end case;
  return v;
end;
$$;
revoke all on function public.approval_snapshot(text, uuid) from public, anon, authenticated;

create or replace function public.approval_hash(p_snapshot jsonb) returns text
language sql immutable strict set search_path = public
as $$ select encode(extensions.digest(convert_to(public.jcs(p_snapshot), 'UTF8'), 'sha256'), 'hex') $$;
revoke all on function public.approval_hash(jsonb) from public, anon, authenticated;

-- Raises the card for a row that waits on the founder. Same snapshot: nothing to do. A changed snapshot
-- supersedes the waiting card (`cancelled`) and raises a new one, so an old screen can no longer approve it.
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
  insert into public.approvals (user_id, kind, department, ref_kind, ref_id, snapshot, content_hash)
  values (p_user, v_kind,
    case v_kind when 'post' then 'writer' when 'reply' then 'sales' else 'brain' end,
    p_ref_kind, p_ref_id, v_snapshot, v_hash);
end;
$$;
revoke all on function public.approval_raise(uuid, text, uuid) from public, anon, authenticated;

-- Closes the waiting card of a row that left review, by whatever path. `edited` when the founder changed what the
-- card showed before approving. `decided_via` comes from `approval_decide` (app or mcp); the old RPCs are the app.
create or replace function public.approval_close(p_ref_kind text, p_ref_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public
as $$
begin
  update public.approvals
  set status = p_status,
      decided_at = now(),
      decided_via = case when p_status in ('approved', 'edited', 'skipped')
        then coalesce(nullif(current_setting('opencmo.decided_via', true), ''), 'app') end
  where ref_kind = p_ref_kind and ref_id = p_ref_id and status = 'waiting';
end;
$$;
revoke all on function public.approval_close(text, uuid, text) from public, anon, authenticated;

create or replace function public.approvals_sync() returns trigger
language plpgsql security definer set search_path = public
as $$
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
    if new.status = 'proposed' then
      perform public.approval_raise(new.user_id, v_ref_kind, new.id);
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
revoke all on function public.approvals_sync() from public, anon, authenticated;

create trigger approvals_sync after insert or update or delete on public.content_items
  for each row execute function public.approvals_sync('content_item');
create trigger approvals_sync after insert or update or delete on public.opportunities
  for each row execute function public.approvals_sync('opportunity');
create trigger approvals_sync after insert or update or delete on public.cmo_goals
  for each row execute function public.approvals_sync('goal');
create trigger approvals_sync after insert or update or delete on public.cmo_corrections
  for each row execute function public.approvals_sync('correction');

-- The one decide RPC under every surface. `p_payload`: `content_hash` (required: what the founder saw), `via`
-- (`app` or `mcp`), and per kind `text` (post, correction), `reason` (post skip, reply dismiss), `goal` and
-- `target` (goal). Actions: post approve|skip, reply replied|dismissed, goal approve|reject,
-- correction approve|edit|reject.
create or replace function public.approval_decide(p_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns public.approvals language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.approvals;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_via text := coalesce(nullif(v_payload->>'via', ''), 'app');
  v_target integer;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'The decision is malformed.' using errcode = '22023';
  end if;
  if v_via not in ('app', 'mcp') then
    raise exception 'Cards are decided in the app or through MCP.' using errcode = '22023';
  end if;
  select * into v_row from public.approvals where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'waiting' then
    raise exception 'This card was already decided.' using errcode = 'P0001';
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'This card expired. A new one will ask again.' using errcode = 'P0001';
  end if;
  if v_payload->>'content_hash' is distinct from v_row.content_hash
     or public.approval_hash(public.approval_snapshot(v_row.ref_kind, v_row.ref_id)) is distinct from v_row.content_hash then
    raise exception 'This card changed. Look at it again before deciding.' using errcode = 'P0001';
  end if;

  perform set_config('opencmo.decided_via', v_via, true);
  case v_row.kind
    when 'post' then
      if p_action not in ('approve', 'skip') then
        raise exception 'Choose approve or skip.' using errcode = '22023';
      end if;
      perform public.cmo_decide_post(v_row.ref_id, p_action, v_payload->>'text', v_payload->>'reason');
    when 'reply' then
      if p_action not in ('replied', 'dismissed') then
        raise exception 'Choose replied or dismissed.' using errcode = '22023';
      end if;
      perform public.cmo_decide_opportunity(v_row.ref_id, p_action, v_payload->>'reason');
    when 'goal' then
      if p_action not in ('approve', 'reject') then
        raise exception 'Choose approve or reject.' using errcode = '22023';
      end if;
      if v_payload ? 'target' then
        if jsonb_typeof(v_payload->'target') <> 'number' then
          raise exception 'The target must be a whole number.' using errcode = '22023';
        end if;
        v_target := (v_payload->>'target')::numeric::integer;
      end if;
      perform public.cmo_decide_goal(v_row.ref_id, p_action, v_payload->>'goal', v_target);
    when 'correction' then
      perform public.cmo_decide_correction(v_row.ref_id, p_action, v_payload->>'text');
    else
      raise exception 'This card cannot be decided yet.' using errcode = 'P0001';
  end case;
  perform set_config('opencmo.decided_via', '', true);

  select * into v_row from public.approvals where id = p_id;
  return v_row;
end;
$$;
revoke all on function public.approval_decide(uuid, text, jsonb) from public, anon;
grant execute on function public.approval_decide(uuid, text, jsonb) to authenticated;

-- Cards for what already waits today. A function so the test can rerun it: a second run raises nothing.
create or replace function public.approvals_backfill() returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_before integer := (select count(*) from public.approvals);
  r record;
begin
  for r in
    select user_id, 'content_item' as ref_kind, id from public.content_items where department = 'post' and status = 'in_review'
    union all select user_id, 'opportunity', id from public.opportunities where status = 'in_review'
    union all select user_id, 'goal', id from public.cmo_goals where status = 'proposed'
    union all select user_id, 'correction', id from public.cmo_corrections where status = 'proposed'
  loop
    perform public.approval_raise(r.user_id, r.ref_kind, r.id);
  end loop;
  return (select count(*) from public.approvals) - v_before;
end;
$$;
revoke all on function public.approvals_backfill() from public, anon, authenticated;
select public.approvals_backfill();

commit;
