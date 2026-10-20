-- 20261220090000: the clipping tool, link imports and the AI CMO's video packs are gone (owner,
-- 2026-10-20: payment providers forbid clipping and content downloaders). What stays: the user
-- uploads their own video and edits it whole. A job is now exactly that: one upload → one `full`
-- clip with its master and transcript, made by the worker (`opencmo/worker/process_job.py`).
--
-- Production data before this migration (2026-10-20): 20 jobs (18 behind blank New edits, 2 failed
-- clip jobs with no clip), 18 clips (all `blank`), 2 `video_ownership` rows, no video packs, no
-- video briefs. Nothing a user can open is deleted.

-- ================================================================ data

-- Clips cut by the old pipeline, every job that imported a link (their sources are not the user's
-- upload), then clipping jobs that have nothing left to open. Storage objects go through the delete
-- triggers, not by hand.
delete from public.clips where kind = 'moment';
delete from public.jobs where source_url !~ '^(storage|editor)://';
delete from public.jobs j
where j.kind = 'clip'
  and j.status in ('done', 'failed', 'cancelled')
  and not exists (select 1 from public.clips c where c.job_id = j.id);

delete from public.tasks where kind in ('zip', 'prepare_full');
delete from public.cmo_inbox where kind = 'video_pack';
delete from public.cmo_runs where kind = 'video_pack';
delete from public.projects where kind = 'video_pack';

-- ================================================================ functions and tables

drop function if exists public.create_clip_job(text, int, text, jsonb, text, text, text, boolean, text, boolean);
drop function if exists public.create_job(text, int, text, jsonb, text, text, text, boolean, text);
drop function if exists public.create_video_pack(text, boolean, integer);
drop function if exists public.cmo_save_video_pack(uuid, uuid, uuid, jsonb, jsonb);
drop function if exists public.cmo_decide_video_pack(uuid, text, jsonb, text);
drop function if exists public.cmo_create_video_brief(uuid, text, text, text, text);
drop function if exists public.cmo_decide_video_brief(uuid, text, text);
drop function if exists public.create_full_edit(uuid);
drop function if exists public.complete_full_edit(uuid, uuid, jsonb, text, jsonb);
drop function if exists public.full_edit_max_seconds();
drop function if exists public.request_zip(uuid, uuid[], uuid);
drop function if exists public.request_original_zip(uuid, uuid[], uuid);
drop function if exists public.agent_open_project_session(uuid, text);
drop function if exists public.publish_job_clip(uuid, uuid, jsonb);

drop table if exists public.video_ownership;
drop table if exists public.video_packs;
drop table if exists public.cmo_video_briefs;

alter table public.jobs drop constraint if exists jobs_segments_check;
alter table public.jobs drop column if exists segments;
alter table public.jobs drop column if exists clip_length;
alter table public.jobs drop column if exists mode;
drop function if exists public.valid_job_segments(jsonb);
drop function if exists public.video_url_refused(text);

-- `jobs_source_url_check` still admits an http(s) source: `create_upload_edit` is the only way to
-- create a job and it takes uploads only, and the worker refuses anything else. Tightening the
-- table check would only rewrite the fixtures of every test that seeds a job directly.

-- `clips_one_full_idx` kept `prepare_full` to one copy per job; the job publishes its one clip by id
-- now, so a retry cannot add a second.
drop index if exists public.clips_one_full_idx;
alter table public.clips alter column kind set default 'full';
alter table public.clips drop constraint if exists clips_kind_check;
alter table public.clips add constraint clips_kind_check check (kind in ('full', 'blank'));

alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in (
  'probe_media', 'generate', 'render_document', 'transcribe_media', 'transcribe_asset', 'capture_page'
));

alter table public.cmo_runs drop constraint if exists cmo_runs_kind_check;
alter table public.cmo_runs add constraint cmo_runs_kind_check check (kind in (
  'onboard', 'plan_week', 'post_draft', 'sales_scan', 'competitor_research', 'pull_metrics',
  'summarize_memory', 'review_week'
));
alter table public.cmo_inbox drop constraint if exists cmo_inbox_kind_check;
alter table public.cmo_inbox add constraint cmo_inbox_kind_check check (kind in (
  'plan_week', 'post_draft', 'sales_scan', 'competitor_research', 'summarize_memory', 'review_week'
));
alter table public.projects drop constraint if exists projects_kind_check;
alter table public.projects add constraint projects_kind_check check (kind in ('clip', 'edit'));

-- Weekly goals counted approved video packs as `clips`; with the packs gone that metric has
-- nothing left to count.
delete from public.cmo_goals where metric = 'clips';
alter table public.cmo_goals drop constraint if exists cmo_goals_metric_check;
alter table public.cmo_goals add constraint cmo_goals_metric_check check (metric in ('posts', 'replies', 'views'));

create or replace function public.cmo_put_goal(p_user uuid, p_run uuid, p_week date, p_goal text, p_metric text, p_target integer)
returns public.cmo_goals language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.cmo_goals;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'The week must start on a Monday.' using errcode = '22023';
  end if;
  if p_week < date_trunc('week', current_date)::date or p_week > date_trunc('week', current_date)::date + 7 then
    raise exception 'Goals are for this week or next week.' using errcode = '22023';
  end if;
  if p_goal is null or char_length(trim(p_goal)) < 3 or char_length(p_goal) > 300 then
    raise exception 'Describe the goal in 3 to 300 characters.' using errcode = '22023';
  end if;
  if p_metric is null or p_metric not in ('posts', 'replies', 'views') then
    raise exception 'The goal must count posts, replies or views.' using errcode = '22023';
  end if;
  if p_target is null or p_target < 1 or p_target > 1000000 then
    raise exception 'The target must be between 1 and 1,000,000.' using errcode = '22023';
  end if;
  select * into v_row from public.cmo_goals where user_id = p_user and week = p_week for update;
  if found and v_row.status = 'approved' then
    raise exception 'This week''s goal is already approved. Edit it on the goal card.' using errcode = 'P0001';
  end if;
  insert into public.cmo_goals (user_id, run_id, week, goal, metric, target)
  values (p_user, p_run, p_week, trim(p_goal), p_metric, p_target)
  on conflict (user_id, week) do update
    set goal = excluded.goal, metric = excluded.metric, target = excluded.target, run_id = excluded.run_id,
        status = 'proposed', decided_at = null, created_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.cmo_put_goal(uuid, uuid, date, text, text, integer) from public, anon, authenticated;

-- ================================================================ the one way to start a project

-- An uploaded video → a job the worker turns into one editable clip. Charging credits and creating
-- the job happen in one transaction (web rule 1); the upload must be the caller's own reservation.
create or replace function public.create_upload_edit(
  p_source_url text,
  p_aspect text default '9:16',
  p_captions boolean default true
) returns public.jobs
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_hold int := public.job_hold_credits();
  v_balance int;
  v_plan text;
  v_job public.jobs;
  v_source text := btrim(coalesce(p_source_url, ''));
  v_aspect text := coalesce(p_aspect, '9:16');
begin
  if v_source not like 'storage://%' then
    raise exception 'Upload the video file to edit it.' using errcode = '22023';
  end if;
  if v_aspect not in ('9:16', '1:1', '16:9') then
    raise exception 'Unsupported aspect ratio.' using errcode = '22023';
  end if;

  if (select count(*) from public.jobs
      where user_id = v_user and status in ('queued', 'running') and purging_at is null) >= 3
  then
    raise exception 'You already have 3 projects in progress. Please wait for one to finish.'
      using errcode = 'P0001';
  end if;
  if not public.rate_limit_hit('jobs', 10, 3600) then
    raise exception 'Too many projects started. Please wait a while and try again.'
      using errcode = 'P0001';
  end if;

  perform public.consume_upload_reservation('sources', substring(v_source from 11), null);

  perform 1 from public.profiles where id = v_user for update;
  v_balance := public.credit_balance(v_user);
  if v_balance < v_hold then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_hold, v_balance using errcode = 'P0001';
  end if;
  select plan into v_plan from public.profiles where id = v_user;

  insert into public.jobs (user_id, source_url, clips_requested, watermark, aspect, captions)
  values (v_user, v_source, 1, coalesce(v_plan, 'free') = 'free', v_aspect, coalesce(p_captions, true))
  returning * into v_job;

  perform public.credit_hold(v_user, 'job', v_job.id, v_hold, 'Hold for new job', v_job.id);
  return v_job;
end;
$$;
revoke all on function public.create_upload_edit(text, text, boolean) from public, anon;
grant execute on function public.create_upload_edit(text, text, boolean) to authenticated;

-- Every project keeps its files for the same window now (the 24 hours of a downloaded "full" copy
-- are gone with that mode).
create or replace function public.set_job_storage_expiry() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status::text in ('done', 'failed', 'cancelled')
     and new.status is distinct from old.status then
    new.expires_at := coalesce(new.finished_at, now()) + interval '7 days';
  elsif new.status::text in ('queued', 'running')
        and old.status::text in ('done', 'failed', 'cancelled') then
    -- A retry needs a fresh window so the cron does not clean the source mid-run.
    new.expires_at := now() + interval '7 days';
  end if;
  return new;
end;
$$;

-- ================================================================ AI CMO without video packs

create or replace function public.cmo_job_daily_limit(p_kind text) returns integer
language sql immutable
as $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    else 0 end
$$;

create or replace function public.cmo_job_price(p_kind text) returns integer
language sql immutable
as $$
  select case p_kind when 'plan_week' then 1 when 'post_draft' then 1 when 'sales_scan' then 5
    when 'competitor_research' then 2 when 'pull_metrics' then 0 when 'summarize_memory' then 0 when 'review_week' then 0
    else 0 end
$$;

create or replace function public.cmo_memories_classify() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.type = 'feedback' then
    new.kind := 'feedback';
    if new.topic = 'general' then
      new.topic := case
        when new.body like 'Skipped the X post%' then 'post'
        when new.body like 'Dismissed the Reddit thread%' then 'sales'
        else 'general' end;
    end if;
    new.expires_at := coalesce(new.expires_at, now() + interval '90 days');
  end if;
  return new;
end;
$$;

create or replace function public.list_projects(
  p_cursor_created_at timestamp with time zone default null,
  p_cursor_id uuid default null,
  p_query text default null,
  p_limit integer default 24
) returns setof public.jobs
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_pattern text;
begin
  if v_query is not null then
    -- `%` and `_` the user types are text, not wildcards. Escape `\` first, or the next two
    -- replacements escape the backslashes they just added.
    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select j.*
  from public.projects p
  join public.jobs j on j.id = p.job_id
  where p.user_id = v_user
    and p.kind = 'clip'
    and (
      p_cursor_created_at is null
      or p_cursor_id is null
      or (j.created_at, j.id) < (p_cursor_created_at, p_cursor_id)
    )
    and (
      v_pattern is null
      or coalesce(j.name, '') ilike v_pattern escape '\'
      or coalesce(j.title, '') ilike v_pattern escape '\'
    )
  order by j.created_at desc, j.id desc
  limit v_limit;
end;
$$;
