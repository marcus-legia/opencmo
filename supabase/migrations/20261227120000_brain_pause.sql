-- 20261227120000: brain B2, the kill switch and the progress check's hooks (docs/architecture/brain.md §9;
-- brain plan W1-4).
--
-- Pause CMO stops every run within a minute and starts nothing new; nothing is deleted, and Resume picks up where it
-- stopped. Three places read the flag: `cmo_enqueue` (nothing new is queued), `claim_cmo_run` (nothing queued is
-- started) and `cmo_run_step` (a running job stops at its next step, as if its lease were lost). Queued runs of a
-- paused founder wait at `not_before = infinity`, so Modal's sweep stops dispatching them without knowing the flag.

begin;

alter table public.profiles add column cmo_paused_at timestamptz;

create or replace function public.cmo_paused(p_user uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select cmo_paused_at is not null from public.profiles where id = p_user), false) $$;
revoke all on function public.cmo_paused(uuid) from public, anon, authenticated;

create or replace function public.cmo_pause() returns timestamptz
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_at timestamptz;
begin
  update public.profiles set cmo_paused_at = coalesce(cmo_paused_at, now()) where id = v_user returning cmo_paused_at into v_at;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  update public.cmo_runs set not_before = 'infinity' where user_id = v_user and status = 'queued';
  return v_at;
end;
$$;
revoke all on function public.cmo_pause() from public, anon;
grant execute on function public.cmo_pause() to authenticated;

create or replace function public.cmo_resume() returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  update public.profiles set cmo_paused_at = null where id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  -- A deferred run resumes a little early; that is harmless, and a paused run must not wait forever.
  update public.cmo_runs set not_before = null where user_id = v_user and status = 'queued' and not_before = 'infinity';
end;
$$;
revoke all on function public.cmo_resume() from public, anon;
grant execute on function public.cmo_resume() to authenticated;

-- Same as 20261210101000 (`cmo_enqueue`) plus the pause check.
create or replace function public.cmo_enqueue(p_user uuid, p_kind text, p_input jsonb) returns public.cmo_runs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.cmo_runs;
  v_price integer := case
    when p_input->>'brain' = 'claude' and public.is_paid(p_user) then 0
    else public.cmo_job_price(p_kind)
  end;
begin
  if p_kind is null or p_kind = 'onboard' or public.cmo_job_daily_limit(p_kind) <= 0 then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 4096 then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  -- Replays are started by inbox_submit only, for an item the founder owns.
  if p_input ? 'inbox' then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  if public.cmo_paused(p_user) then
    raise exception 'Your CMO is paused. Resume it to start new work.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':cmo_run', 1713));

  select * into v_row from public.cmo_runs
  where user_id = p_user and kind = p_kind and status in ('queued', 'running')
    and (status = 'queued' or lease_until is null or lease_until > now())
  order by created_at desc limit 1;
  if found then
    return v_row;
  end if;

  if (select count(*) from public.cmo_runs
      where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day'
        and not (input ? 'inbox')) >= public.cmo_job_daily_limit(p_kind) then
    raise exception 'You have reached today''s limit for this task. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if v_price > 0 and public.credit_balance(p_user) < v_price then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_price, public.credit_balance(p_user) using errcode = 'P0001';
  end if;

  insert into public.cmo_runs (user_id, kind, status, input, credits)
  values (p_user, p_kind, 'queued', p_input, v_price) returning * into v_row;
  if v_price > 0 then
    perform public.credit_hold(p_user, 'cmo_run', v_row.id, v_price, 'CMO hold');
  end if;
  return v_row;
end;
$$;

-- Same as 20261016090000 plus the pause: a lost lease of a paused founder goes back to the queue parked, and the claim
-- never starts a paused founder's run (an inbox replay inserted while paused included).
create or replace function public.claim_cmo_run(p_run_id uuid default null, p_lease_seconds integer default 300)
returns public.cmo_runs language plpgsql security definer set search_path = public
as $$
declare
  v_row public.cmo_runs;
  v_dead public.cmo_runs;
begin
  for v_dead in
    update public.cmo_runs set status = 'failed', error = 'This task stopped too many times.', finished_at = now(), lease_until = null
    where status = 'running' and kind <> 'onboard' and lease_until < now() and attempt >= 3
    returning *
  loop
    perform public.cmo_refund_run(v_dead);
  end loop;
  update public.cmo_runs set status = 'queued', lease_until = null,
    not_before = case when public.cmo_paused(user_id) then 'infinity'::timestamptz else not_before end
  where status = 'running' and kind <> 'onboard' and lease_until < now() and attempt < 3;

  select * into v_row from public.cmo_runs r
  where status = 'queued' and (p_run_id is null or id = p_run_id)
    and (not_before is null or not_before <= now())
    and not public.cmo_paused(r.user_id)
  order by created_at
  for update skip locked
  limit 1;
  if not found then
    return null;
  end if;

  update public.cmo_runs
  set status = 'running', attempt = attempt + 1, started_at = coalesce(started_at, now()),
      lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900)))
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

-- A paused founder's running job stops at its next step: the runner treats `false` as a lost lease.
create or replace function public.cmo_run_step(p_run uuid, p_attempt integer, p_steps jsonb) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update public.cmo_runs set steps = p_steps, lease_until = now() + interval '300 seconds'
  where id = p_run and attempt = p_attempt and status = 'running' and not public.cmo_paused(user_id);
  return found;
end;
$$;

-- The progress check (lib/cmo/jobs/progress.ts) replans a stuck order once: it marks the order so the next check
-- leaves it alone, and fails a stuck running order first so the replan reads why.
create or replace function public.work_order_mark_replanned(p_id uuid, p_problem text)
returns public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.work_orders;
begin
  select * into v_row from public.work_orders where id = p_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if v_row.brief ? 'replanned_at' then
    raise exception 'This order was already replanned once.' using errcode = 'P0001';
  end if;
  if v_row.status not in ('failed', 'done', 'cancelled') then
    v_row := public.work_order_move(p_id, 'failed', null,
      jsonb_build_object('code', 'stuck', 'message', left(coalesce(p_problem, 'No progress.'), 300), 'retryable', true,
        'repair_hint', 'Plan around it with a different item.'));
  end if;
  update public.work_orders set brief = brief || jsonb_build_object('replanned_at', now()), updated_at = now()
  where id = p_id returning * into v_row;
  perform public.work_order_event(v_row, 'note', 'Asked the Planner to replan “' || v_row.title || '”');
  return v_row;
end;
$$;
revoke all on function public.work_order_mark_replanned(uuid, text) from public, anon, authenticated;

commit;
