-- Web hardening round 4, session B (docs/plans/engineering/2026-11-17-web-hardening-round-4-plan.md).
--
-- 1. The grouping of `ops_failures_report` (20270128010000) moves into one internal function, `ops_failure_groups`,
--    so the owner's page and the hourly Sentry alert (`/api/cron/failures`) group failures the same way. The grouping
--    itself is unchanged, line for line. Only `service_role` (the alert's cron) may call it: it does no owner check.
-- 2. Both gain `warnings`: an upload the worker published with a fallback, which never ends `failed` and so was
--    invisible (CLAUDE.md "Known traps": a Scribe failure, a face detector missing). The worker writes the codes in
--    `jobs.media_manifest.warnings` (packages/engine/opencmo/worker/process_job.py), through
--    `complete_job_publication`, which already stores the manifest whole: no RPC or column change, so a worker deployed
--    before or after this migration works with it. Only short lowercase codes are counted, so nothing else in a
--    manifest can turn into text on the page or in Sentry.
--
-- No table or view is created: nothing needs a grant after round 4 session A's revoke (20270129…).

-- The hourly alert reads warnings on every run: only the few jobs that carry one are indexed.
create index if not exists jobs_warnings_finished_idx on public.jobs (finished_at)
  where status = 'done' and media_manifest ? 'warnings';

create or replace function public.ops_failure_groups(p_since timestamptz) returns jsonb
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_stuck_after interval := interval '10 minutes';
  v_result jsonb;
begin
  if p_since is null then
    raise exception 'A start time is required.' using errcode = '22023';
  end if;

  with raw as (
    select 'jobs'::text as source, j.kind, j.id, j.user_id, coalesce(j.finished_at, j.created_at) as at, j.error, false as stuck
      from public.jobs j where j.status = 'failed' and coalesce(j.finished_at, j.created_at) >= p_since
    union all
    select 'jobs', j.kind, j.id, j.user_id, j.lease_until, null, true
      from public.jobs j where j.status = 'running' and j.lease_until < now() - v_stuck_after
    union all
    select 'tasks', t.kind, t.id, t.user_id, coalesce(t.finished_at, t.created_at), t.error, false
      from public.tasks t where t.status = 'failed' and coalesce(t.finished_at, t.created_at) >= p_since
        and not (t.kind = 'generate' and exists (select 1 from public.generations g where g.task_id = t.id))
    union all
    select 'tasks', t.kind, t.id, t.user_id, t.lease_until, null, true
      from public.tasks t where t.status = 'running' and t.lease_until < now() - v_stuck_after
    union all
    select 'cmo_runs', r.kind, r.id, r.user_id, coalesce(r.finished_at, r.created_at), r.error, false
      from public.cmo_runs r where r.status = 'failed' and coalesce(r.finished_at, r.created_at) >= p_since
    union all
    select 'cmo_runs', r.kind, r.id, r.user_id, r.lease_until, null, true
      from public.cmo_runs r where r.status = 'running' and r.lease_until < now() - v_stuck_after
    union all
    select 'cmo_runs', r.kind, r.id, r.user_id, coalesce(r.started_at, r.created_at), null, true
      from public.cmo_runs r
      where r.status = 'running' and r.kind = 'onboard' and r.lease_until is null
        and coalesce(r.started_at, r.created_at) < now() - interval '30 minutes'
    union all
    select 'generations', g.kind, g.id, g.user_id, coalesce(g.finished_at, g.created_at), g.error, false
      from public.generations g where g.status = 'failed' and coalesce(g.finished_at, g.created_at) >= p_since
    union all
    select 'studio_steps', s.kind || '/' || s.tool, s.id, s.user_id, greatest(s.created_at, s.decided_at, s.claimed_at), s.error, false
      from public.studio_steps s where s.status = 'failed' and greatest(s.created_at, s.decided_at, s.claimed_at) >= p_since
    union all
    select 'work_orders', w.department || '/' || w.kind, w.id, w.user_id, coalesce(w.finished_at, w.updated_at),
        concat_ws(': ', w.error->>'code', w.error->>'message'), false
      from public.work_orders w where w.status = 'failed' and coalesce(w.finished_at, w.updated_at) >= p_since
        and not exists (select 1 from public.cmo_runs r where r.id = w.run_id and r.status = 'failed')
    union all
    select 'schedule_slots', s.platform, s.id, s.user_id, s.updated_at, s.error->>'message', false
      from public.schedule_slots s where s.status = 'failed' and s.updated_at >= p_since
    union all
    select 'schedule_slots', s.platform, s.id, s.user_id, s.lease_until, null, true
      from public.schedule_slots s where s.status = 'publishing' and s.lease_until < now() - v_stuck_after
    union all
    select 'agent_turns', 'assistant', t.id, a.user_id, coalesce(t.finished_at, t.created_at), t.error, false
      from public.agent_turns t join public.agent_sessions a on a.id = t.session_id
      where t.status = 'failed' and coalesce(t.finished_at, t.created_at) >= p_since
  ),
  owners as (
    select u.id from auth.users u join public.app_owners o on o.email = lower(u.email)
  ),
  f as (
    select r.source, r.kind, r.id, r.user_id, r.at, r.stuck,
      coalesce(nullif(btrim(r.error), ''),
        case when r.stuck then 'Stuck: still running past its lease or time limit.' else 'Failed with no error text.' end) as error
    from raw r
    where r.user_id not in (select id from owners)
  ),
  -- One bug is one row: ids (uuids, and long tokens with two digits or more) and numbers are collapsed, whitespace too.
  -- A number keeps its unit (`<n> ms`, `<n>s`, `<n>p`) and a digit inside a word stays (`mp4`, `h264`). A 4xx or 5xx
  -- code stays only where it reads as an HTTP status (after "status", "HTTP", "code", "error", "returned", "answered",
  -- or before a reason phrase such as "Internal Server Error"), so an expired token (401) and an outage (500) are two
  -- rows while "Retried 450 times" and "Retried 37 times" are one. The code is held as `HTTP_<code>` while the numbers
  -- collapse, then put back. The key is cut after it is normalized, so two long errors that differ only by an id's
  -- length still meet.
  k as (
    select f.source, f.kind, f.id, f.user_id, f.at, f.stuck, left(f.error, 300) as error,
      regexp_replace(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        regexp_replace(regexp_replace(f.error,
        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'gi'),
        '(?=[A-Za-z_-]*[0-9][A-Za-z_-]*[0-9])[A-Za-z0-9_-]{16,}', '<id>', 'g'),
        '\m(status|http|code|error|returned|responded|answered)(\s+code)?(\s*[:=]?\s*)([45][0-9][0-9])\M',
          '\1\2\3HTTP_\4', 'gi'),
        '\m([45][0-9][0-9])(\s+(bad|unauthorized|forbidden|not|internal|service|gateway|too|conflict|payment|unprocessable|request|precondition|method|gone))',
          'HTTP_\1\2', 'gi'),
        '\m[0-9]+([.,][0-9]+)*(ms|s|m|h|p|px|k|kb|mb|gb|x)\M', '<n>\2', 'gi'),
        '\m[0-9]+([.,][0-9]+)*\M', '<n>', 'g'),
        '\s+', ' ', 'g')), 300), 'HTTP_([45][0-9][0-9])', '\1', 'g') as key
    from f
  ),
  g as (
    select source, kind, key, count(*) as failures, count(distinct user_id) as accounts,
      min(at) as first_seen, max(at) as last_seen, bool_or(stuck) as stuck
    from k group by source, kind, key
    order by count(distinct user_id) desc, count(*) desc, max(at) desc
    limit 100
  ),
  latest as (
    select k.source, k.kind, k.key,
      jsonb_agg(jsonb_build_object('id', k.id, 'user_id', k.user_id, 'at', k.at, 'error', k.error, 'stuck', k.stuck)
        order by k.at desc) as rows
    from (
      select k.*, row_number() over (partition by k.source, k.kind, k.key order by k.at desc) as rn
      from k join g using (source, kind, key)
    ) k
    where k.rn <= 20
    group by k.source, k.kind, k.key
  )
  ,
  -- Uploads published with a fallback (see the header). One row per job and code; a code repeated in one manifest
  -- counts once.
  w as (
    select distinct j.id, j.user_id, j.finished_at as at, c.code
    from public.jobs j
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(j.media_manifest->'warnings') = 'array' then j.media_manifest->'warnings' else '[]'::jsonb end
      ) as c(code)
    where j.status = 'done' and j.media_manifest ? 'warnings' and j.finished_at >= p_since
      and c.code ~ '^[a-z][a-z0-9_]{0,63}$'
      and j.user_id not in (select id from owners)
  ),
  wg as (
    select w.code, count(*) as jobs, count(distinct w.user_id) as accounts, min(w.at) as first_seen,
      max(w.at) as last_seen,
      (array_agg(w.id::text order by w.at desc))[1:5] as latest
    from w group by w.code
  )
  select jsonb_build_object(
    -- Stuck work is listed whatever the window, so it stays out of "failures in the last N days" and is counted
    -- once, under `stuck`.
    'failures', (select count(*) from k where not stuck),
    'accounts', (select count(distinct user_id) from k where not stuck),
    'stuck', (select count(*) from k where stuck),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
          'source', g.source, 'kind', g.kind, 'key', g.key, 'failures', g.failures, 'accounts', g.accounts,
          'first_seen', g.first_seen, 'last_seen', g.last_seen, 'stuck', g.stuck, 'latest', l.rows)
        order by g.accounts desc, g.failures desc, g.last_seen desc)
      from g join latest l using (source, kind, key)
    ), '[]'::jsonb),
    'warnings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', wg.code, 'jobs', wg.jobs, 'accounts', wg.accounts, 'first_seen', wg.first_seen,
          'last_seen', wg.last_seen, 'latest', to_jsonb(wg.latest))
        order by wg.accounts desc, wg.jobs desc, wg.last_seen desc)
      from wg
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.ops_failure_groups(timestamptz) from public, anon, authenticated;
grant execute on function public.ops_failure_groups(timestamptz) to service_role;

-- The owner's page: the same answer as before (owner check and window unchanged), plus `warnings`.
create or replace function public.ops_failures_report(p_days integer default 7) returns jsonb
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_since timestamptz;
begin
  if not exists (select 1 from public.app_owners where email = v_email) then
    raise exception 'Not available.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Pick 1 to 90 days.' using errcode = '22023';
  end if;
  v_since := now() - make_interval(days => p_days);
  return jsonb_build_object('since', v_since, 'days', p_days) || public.ops_failure_groups(v_since);
end;
$$;

revoke all on function public.ops_failures_report(integer) from public, anon;
grant execute on function public.ops_failures_report(integer) to authenticated;
