-- Style skills, Track C (docs/style-skills-build.md): page captures for proof B-roll.
--
-- The Assistant captures a public page the speaker cites (a GitHub README, a pricing page), and
-- `add_proof` shows it on the clip in a browser frame, zoomed to the words the speaker quotes.
-- The worker task `capture_page` opens the page in a sandboxed Chromium with no secrets, runs the
-- screenshot through image moderation and stores `page.png` + `page.boxes.json` in the private
-- `captures` bucket.
--
-- Captures are free and move no credits, so there is no credit_hold here. They are capped at 30
-- per user per rolling 24 h, and the same user asking for the same page within 24 h gets the
-- capture they already have.
--
-- The address check below is the first layer only: it refuses what is plainly not a public
-- page so the user hears it at once. The capture itself resolves every host and refuses private,
-- loopback, link-local and metadata addresses for every request the page makes.

begin;

alter table public.tasks drop constraint tasks_kind_check;
alter table public.tasks
  add constraint tasks_kind_check
  check (kind in ('probe_media', 'zip', 'generate', 'render_document', 'prepare_full',
                  'transcribe_media', 'transcribe_asset', 'capture_page'));

create table public.page_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Normalized by `normalize_capture_url`: the cache key and the address the browser frame shows.
  url text not null check (char_length(url) between 1 and 2048),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error text check (char_length(error) <= 500),
  task_id uuid references public.tasks(id) on delete set null,
  title text check (char_length(title) <= 300),
  -- CSS pixels of the captured page (the PNG is twice that).
  width integer check (width > 0),
  height integer check (height > 0),
  image_path text,
  boxes_path text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint page_captures_ready_check check (
    status <> 'ready' or (image_path is not null and boxes_path is not null and width is not null and height is not null)
  )
);

create index page_captures_user_recent_idx on public.page_captures (user_id, created_at desc);
create index page_captures_task_idx on public.page_captures (task_id);

alter table public.page_captures enable row level security;
create policy "read own page captures" on public.page_captures
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.page_captures to authenticated;
grant all on public.page_captures to service_role;

/** Captures per user per rolling 24 h (docs/style-skills-build.md, Decisions). */
create or replace function public.capture_daily_limit()
returns integer language sql immutable as $$ select 30 $$;

-- The address a capture is cached by, or an English refusal (it reaches the user verbatim).
-- Scheme and host are lowercased, the default port and the fragment dropped; anything that is
-- not a plain public http(s) address on its default port is refused.
create or replace function public.normalize_capture_url(p_url text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_parts text[];
  v_scheme text;
  v_authority text;
  v_rest text;
  v_host text;
  v_port text;
  v_ip inet;
begin
  if v_url = '' then
    raise exception 'Give the address of the page to capture.' using errcode = '22023';
  end if;
  if char_length(v_url) > 2048 then
    raise exception 'That address is too long.' using errcode = '22023';
  end if;
  if v_url ~ '[[:space:][:cntrl:]]' then
    raise exception 'That address is not allowed.' using errcode = '22023';
  end if;
  v_parts := regexp_match(v_url, '^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]*)([^#]*)');
  if v_parts is null or lower(v_parts[1]) not in ('http', 'https') then
    raise exception 'Only http and https pages can be captured.' using errcode = '22023';
  end if;
  v_scheme := lower(v_parts[1]);
  v_authority := lower(v_parts[2]);
  v_rest := coalesce(nullif(v_parts[3], ''), '/');
  if v_rest !~ '^[/?]' then
    v_rest := '/' || v_rest;
  end if;
  -- No credentials in the address, no IPv6 literals (a public page has a name).
  if v_authority = '' or position('@' in v_authority) > 0 or position('[' in v_authority) > 0 then
    raise exception 'That address is not allowed.' using errcode = '22023';
  end if;
  v_host := split_part(v_authority, ':', 1);
  v_port := nullif(substr(v_authority, char_length(v_host) + 2), '');
  if v_port is not null and v_port <> (case when v_scheme = 'http' then '80' else '443' end) then
    raise exception 'That address is not allowed.' using errcode = '22023';
  end if;
  v_host := rtrim(v_host, '.');
  if v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' then
    begin
      v_ip := v_host::inet;
    exception when others then
      raise exception 'That address is not allowed.' using errcode = '22023';
    end;
    if v_ip << '0.0.0.0/8' or v_ip << '10.0.0.0/8' or v_ip << '100.64.0.0/10' or v_ip << '127.0.0.0/8'
       or v_ip << '169.254.0.0/16' or v_ip << '172.16.0.0/12' or v_ip << '192.0.0.0/24'
       or v_ip << '192.0.2.0/24' or v_ip << '192.168.0.0/16' or v_ip << '198.18.0.0/15'
       or v_ip << '198.51.100.0/24' or v_ip << '203.0.113.0/24' or v_ip << '224.0.0.0/3' then
      raise exception 'That address is not allowed.' using errcode = '22023';
    end if;
  -- A name with a dot and a real top-level label: no `localhost`, no single-label intranet names,
  -- no numeric tricks like `0x7f.1` that browsers read as an IP address.
  elsif v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
     or v_host ~ '(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|onion|test|invalid|example)$' then
    raise exception 'That address is not allowed.' using errcode = '22023';
  end if;
  return v_scheme || '://' || v_host || v_rest;
end;
$$;

revoke all on function public.normalize_capture_url(text) from public, anon;
grant execute on function public.normalize_capture_url(text) to authenticated, service_role;

-- Ask for a capture of a page; returns the capture id. The same page captured by the same user
-- within 24 h (pending or ready) comes back from the cache and does not count again.
create or replace function public.capture_create(p_url text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_url text := public.normalize_capture_url(p_url);
  v_id uuid;
  v_task uuid;
  v_used integer;
begin
  -- One lock per user: two requests at once can neither both slip under the cap nor both
  -- create the same capture.
  perform public.lock_credit_owner(v_user);
  select id into v_id from public.page_captures
  where user_id = v_user and url = v_url and status in ('pending', 'ready')
    and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1;
  if found then
    return v_id;
  end if;
  select count(*) into v_used from public.page_captures
  where user_id = v_user and created_at > now() - interval '24 hours';
  if v_used >= public.capture_daily_limit() then
    raise exception 'You have captured % pages in the last 24 hours, the most there is. Try again tomorrow.',
      public.capture_daily_limit() using errcode = 'P0001';
  end if;
  v_id := gen_random_uuid();
  insert into public.page_captures (id, user_id, url) values (v_id, v_user, v_url);
  insert into public.tasks (user_id, kind, payload, status, request_id)
  values (v_user, 'capture_page',
          jsonb_build_object('capture_id', v_id, 'url', v_url, 'width', 1280, 'max_height', 8000),
          'queued', gen_random_uuid())
  returning id into v_task;
  update public.page_captures set task_id = v_task where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.capture_create(text) from public, anon;
grant execute on function public.capture_create(text) to authenticated;

-- Worker: the files are stored; the capture is ready and its task done, in one transaction.
-- The paths are the only ones the task may write (`<user>/<capture>/page.png|page.boxes.json`).
-- A repeated call for the same attempt returns true (idempotent like complete_task).
create or replace function public.complete_page_capture(
  p_task_id uuid, p_attempt_id uuid, p_title text, p_width integer, p_height integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_capture public.page_captures;
  v_prefix text;
begin
  select * into v_task from public.tasks
  where id = p_task_id and kind = 'capture_page' and attempt_id is not distinct from p_attempt_id
  for update;
  if not found then return false; end if;
  if v_task.status = 'done' then return true; end if;
  if v_task.status <> 'running' then return false; end if;
  select * into v_capture from public.page_captures
  where id = (v_task.payload ->> 'capture_id')::uuid and user_id = v_task.user_id and task_id = v_task.id
  for update;
  if not found then
    raise exception 'This capture no longer exists.' using errcode = 'P0002';
  end if;
  if p_width is null or p_width < 1 or p_height is null or p_height < 1 then
    raise exception 'Invalid capture size.' using errcode = '22023';
  end if;
  v_prefix := v_task.user_id::text || '/' || v_capture.id::text || '/';
  update public.page_captures
  set status = 'ready', error = null, title = left(nullif(btrim(coalesce(p_title, '')), ''), 300),
      width = p_width, height = p_height,
      image_path = v_prefix || 'page.png', boxes_path = v_prefix || 'page.boxes.json',
      finished_at = now()
  where id = v_capture.id;
  update public.tasks
  set status = 'done', error = null, finished_at = now(), lease_until = null,
      output = jsonb_build_object('capture_id', v_capture.id, 'width', p_width, 'height', p_height)
  where id = v_task.id;
  return true;
end;
$$;

revoke all on function public.complete_page_capture(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.complete_page_capture(uuid, uuid, text, integer, integer) to service_role;

-- A capture whose task ends any other way (fail_task, cancel, the lease reaper giving up) is
-- failed with the task's sentence, which the worker writes in English for the user.
create or replace function public.sync_page_capture_from_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'capture_page' or new.status is not distinct from old.status
     or new.status not in ('failed', 'cancelled') then
    return new;
  end if;
  update public.page_captures
  set status = 'failed', finished_at = now(),
      error = left(coalesce(nullif(new.error, ''), 'That page could not be opened.'), 500)
  where task_id = new.id and status = 'pending';
  return new;
end;
$$;

revoke all on function public.sync_page_capture_from_task() from public, anon, authenticated;
create trigger tasks_sync_page_capture after update of status on public.tasks
  for each row execute function public.sync_page_capture_from_task();

-- Storage: private bucket, written only by the worker (service role), read by the owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 26214400, array['image/png', 'application/json'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "read own page captures" on storage.objects;
create policy "read own page captures"
  on storage.objects for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.storage_deletions drop constraint storage_deletions_bucket_check;
alter table public.storage_deletions add constraint storage_deletions_bucket_check
  check (bucket in ('clips', 'sources', 'renders', 'media', 'exports', 'brand', 'captures'));

-- Free accounts past retention lose their captures with everything else.
create or replace function public.purge_unpaid_accounts(p_limit integer default 50)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500.';
  end if;

  for v_user in
    select p.id
    from public.profiles p
    where p.retention_from + interval '30 days' < now()
      and not public.account_is_paid(p.id)
      -- Work still running (the worker holds a lease): leave it to the next cron run.
      and not exists (
        select 1 from public.tasks t
        where t.user_id = p.id and t.status in ('queued', 'running')
      )
    order by p.retention_from
    limit p_limit
    for update of p skip locked
  loop
    insert into public.storage_deletions (bucket, path, user_id)
    select o.bucket_id, o.name, v_user
    from storage.objects o
    where o.bucket_id in ('clips', 'sources', 'renders', 'media', 'exports', 'brand', 'captures')
      and o.name like v_user::text || '/%'
      and not exists (
        select 1 from public.storage_deletions d where d.bucket = o.bucket_id and d.path = o.name
      );
    return next v_user;
  end loop;
end;
$$;

revoke all on function public.purge_unpaid_accounts(integer) from public, anon, authenticated;
grant execute on function public.purge_unpaid_accounts(integer) to service_role;

commit;
