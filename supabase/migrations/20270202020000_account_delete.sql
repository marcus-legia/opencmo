-- Wave 4a A2 (docs/plans/cmo/2026-11-20-wave4-plan.md, task 3; owner decision 2, default): a founder deletes their
-- own account from Settings › Account.
--
-- It is the same purge the 30-day cleanup of unpaid accounts runs (20261108090000), not a second one:
--   1. SQL queues the account's files in `storage_deletions` (`account_purge_files`, now shared by both paths);
--   2. the server removes the auth user with `auth.admin.deleteUser`, and the cascade from `auth.users` removes the
--      rows. The route does it right after `account_delete()` answers; if that call fails, the daily cleanup does it,
--      because `purge_unpaid_accounts` now also returns every account whose own deletion is asked and not done.
-- `account_deletions` is the purge log: one row per deletion asked (`self`) or chosen by the cleanup (`unpaid`), closed
-- by a trigger when the auth user is gone. It keeps no email and no name, only the id and the times.
--
-- Add-only: a new table, two new functions, a trigger, and `purge_unpaid_accounts` replaced with the same signature
-- and the same result for the code already in production.

create table if not exists public.account_deletions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  source text not null check (source in ('self', 'unpaid')),
  requested_at timestamptz not null default now(),
  done_at timestamptz
);

-- One open deletion per account: asking twice, or the cleanup picking a user already asked for, adds nothing.
create unique index if not exists account_deletions_open_key on public.account_deletions (user_id) where done_at is null;

alter table public.account_deletions enable row level security;
revoke all on table public.account_deletions from public, anon, authenticated;
grant select, insert, update, delete on table public.account_deletions to service_role;

-- The files of one account, queued for the cleanup's storage sweep. Both deletion paths call it.
create or replace function public.account_purge_files(p_user uuid)
returns integer
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_count integer;
begin
  insert into public.storage_deletions (bucket, path, user_id)
  select o.bucket_id, o.name, p_user
  from storage.objects o
  where o.bucket_id in ('clips', 'sources', 'renders', 'media', 'exports', 'brand', 'captures', 'photos')
    and o.name like p_user::text || '/%'
    and not exists (
      select 1 from public.storage_deletions d where d.bucket = o.bucket_id and d.path = o.name
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.account_purge_files(uuid) from public, anon, authenticated;
grant execute on function public.account_purge_files(uuid) to service_role;

-- The cleanup's pick: first the deletions founders asked for, then unpaid accounts past 30 days. The caller deletes
-- each returned user with `auth.admin.deleteUser`; one that fails is returned again next run.
create or replace function public.purge_unpaid_accounts(p_limit integer default 50)
returns setof uuid
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid;
  v_left integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500.';
  end if;
  v_left := p_limit;

  for v_user in
    select d.user_id
    from public.account_deletions d
    where d.done_at is null and d.source = 'self'
      and exists (select 1 from auth.users u where u.id = d.user_id)
      -- Work still running (the worker holds a lease): leave it to the next cron run.
      and not exists (
        select 1 from public.tasks t
        where t.user_id = d.user_id and t.status in ('queued', 'running')
      )
    order by d.requested_at
    limit v_left
    for update of d skip locked
  loop
    -- Files uploaded after the founder asked are queued too.
    perform public.account_purge_files(v_user);
    v_left := v_left - 1;
    return next v_user;
  end loop;

  if v_left < 1 then
    return;
  end if;

  for v_user in
    select p.id
    from public.profiles p
    where p.retention_from + interval '30 days' < now()
      and not public.account_is_paid(p.id)
      and not exists (
        select 1 from public.tasks t
        where t.user_id = p.id and t.status in ('queued', 'running')
      )
      -- An unpaid pick whose `deleteUser` failed is checked again here, so an account that paid since is kept.
      and not exists (
        select 1 from public.account_deletions d where d.user_id = p.id and d.done_at is null and d.source = 'self'
      )
    order by p.retention_from
    limit v_left
    for update of p skip locked
  loop
    perform public.account_purge_files(v_user);
    insert into public.account_deletions (user_id, source) values (v_user, 'unpaid')
    on conflict (user_id) where done_at is null do nothing;
    return next v_user;
  end loop;
end;
$$;

revoke all on function public.purge_unpaid_accounts(integer) from public, anon, authenticated;
grant execute on function public.purge_unpaid_accounts(integer) to service_role;

-- The founder's own deletion. The typed email must be the account's; a plan that can still charge must be cancelled
-- first; running work must finish (the worker holds a lease on it). Returns the id the server then deletes from Auth.
create or replace function public.account_delete(p_email text)
returns jsonb
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_email text;
  v_files integer;
begin
  select u.email into v_email from auth.users u where u.id = v_user;
  if p_email is null or v_email is null or lower(btrim(p_email)) <> lower(btrim(v_email)) then
    raise exception 'The email you typed is not the one on this account.' using errcode = '22023';
  end if;

  -- Statuses that can still take a payment. A plan set to cancel at the period end charges nothing more.
  if exists (
    select 1 from public.creem_subscriptions s
    where s.user_id = v_user and s.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
  ) then
    raise exception 'Cancel your plan first, on the Billing page. Then you can delete your account.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.tasks t where t.user_id = v_user and t.status in ('queued', 'running')) then
    raise exception 'A video is still being processed. Try again when it is done.' using errcode = 'P0001';
  end if;

  perform 1 from public.profiles p where p.id = v_user for update;

  insert into public.account_deletions (user_id, source) values (v_user, 'self')
  on conflict (user_id) where done_at is null do nothing;
  v_files := public.account_purge_files(v_user);

  return jsonb_build_object('user_id', v_user, 'files', v_files);
end;
$$;

revoke all on function public.account_delete(text) from public, anon;
grant execute on function public.account_delete(text) to authenticated, service_role;

-- Closes the log row when the auth user is gone, whichever path removed it.
create or replace function public.account_deletions_done()
returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  update public.account_deletions set done_at = now() where user_id = old.id and done_at is null;
  return old;
end;
$$;

revoke all on function public.account_deletions_done() from public, anon, authenticated;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.account_deletions_done();
