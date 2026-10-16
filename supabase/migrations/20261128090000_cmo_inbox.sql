-- 20261128090000: the CMO inbox ("Continue in Claude", docs/mcp-on-modal-plan.md).
--
-- When OpenCMO's own models cannot think for a founder (credits below one Assistant hold, or our
-- LLM keys down), a CMO run is enqueued with `input.brain = 'claude'`. It reads everything it
-- needs server-side as usual and stops at its first model call: the request (system text, prompt,
-- JSON schema) goes to this inbox and the run ends. The founder's own Claude reads the item over
-- MCP, does the thinking and submits the answer; the submission enqueues a replay run that feeds
-- the answer to the same job code, so the job's zod schema, deterministic checks and approval
-- cards are unchanged. A job with several model calls goes round once per call.
--
-- Thinking in the inbox costs no credits: such runs hold 0. Nothing here posts anything.

begin;

create table public.cmo_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan_week', 'post_draft', 'sales_scan', 'video_pack', 'competitor_research', 'summarize_memory', 'review_week')),
  -- The run input the replays start from (brief, item, loop), without `inbox` itself.
  input jsonb not null default '{}' check (jsonb_typeof(input) = 'object' and octet_length(input::text) <= 4096),
  -- The model call waiting for an answer: its label and what the job would have sent.
  step text not null check (step ~ '^[a-z_]{1,40}$'),
  request jsonb not null check (jsonb_typeof(request) = 'object' and octet_length(request::text) <= 1048576),
  -- Answers already given, by step: the replay hands them back to the job in order.
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 262144),
  -- Results of steps that must not run twice (a Reddit search between two rounds).
  memo jsonb not null default '{}' check (jsonb_typeof(memo) = 'object' and octet_length(memo::text) <= 1048576),
  status text not null default 'open' check (status in ('open', 'claimed', 'submitted', 'done', 'expired')),
  -- Why the last answer did not make it (a check failed): shown to Claude with the reopened item.
  feedback text check (char_length(feedback) <= 1000),
  rounds integer not null default 0 check (rounds >= 0),
  last_request_id uuid,
  run_id uuid references public.cmo_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  submitted_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '3 days'
);
create index cmo_inbox_user_idx on public.cmo_inbox (user_id, status, created_at desc);
alter table public.cmo_inbox enable row level security;
create policy "read own inbox" on public.cmo_inbox
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.cmo_inbox from anon, authenticated;

-- How many answers one item may take before it is closed: a job has at most three model calls,
-- the rest is room for answers a check sent back.
create or replace function public.cmo_inbox_max_rounds() returns integer
language sql immutable as $$ select 8 $$;

-- An inbox run thinks with the founder's Claude: it holds no credits. Only the service role may
-- start one for another user (the cron); a founder's own `enqueue_cmo_run` may ask for it too,
-- since its reads stay under the same daily caps and no model of ours runs.
create or replace function public.cmo_enqueue(p_user uuid, p_kind text, p_input jsonb)
returns public.cmo_runs
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.cmo_runs;
  v_price integer := case when p_input->>'brain' = 'claude' then 0 else public.cmo_job_price(p_kind) end;
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

-- Runner (service role): the run reached a model call it may not make. Writes the request to the
-- run's inbox item (a new one on the first round) and ends the run in the same transaction, so a
-- run that dies in between is re-claimed and opens the same item again instead of a second one.
create or replace function public.cmo_inbox_open(p_run uuid, p_attempt integer, p_step text, p_request jsonb, p_memo jsonb default '{}')
returns public.cmo_inbox
language plpgsql security definer set search_path = public
as $$
declare
  v_run public.cmo_runs;
  v_item public.cmo_inbox;
  v_inbox uuid;
begin
  select * into v_run from public.cmo_runs where id = p_run and attempt = p_attempt and status = 'running' for update;
  if not found then
    return null;
  end if;
  if v_run.input->>'brain' is distinct from 'claude' then
    raise exception 'This run does not use the inbox.' using errcode = '22023';
  end if;
  v_inbox := nullif(v_run.input->>'inbox', '')::uuid;

  if v_inbox is null then
    -- A fresh scheduled item replaces the founder's older unclaimed one of the same kind:
    -- yesterday's draft request is stale once today's exists.
    update public.cmo_inbox set status = 'expired', finished_at = now()
    where user_id = v_run.user_id and kind = v_run.kind and status = 'open';
    insert into public.cmo_inbox (user_id, kind, input, step, request, memo, run_id)
    values (v_run.user_id, v_run.kind, v_run.input - 'brain', p_step, p_request, coalesce(p_memo, '{}'), v_run.id)
    returning * into v_item;
  else
    update public.cmo_inbox
    set step = p_step, request = p_request, memo = memo || coalesce(p_memo, '{}'), status = 'open',
        feedback = null, claimed_at = null, run_id = v_run.id
    where id = v_inbox and user_id = v_run.user_id and status = 'submitted'
    returning * into v_item;
    if not found then
      raise exception 'This inbox item is no longer waiting.' using errcode = 'P0001';
    end if;
  end if;

  perform public.complete_cmo_run(p_run, p_attempt, true,
    jsonb_build_object('inbox_id', v_item.id, 'waiting_for', p_step), null);
  return v_item;
end;
$$;

-- Runner (service role): a replay run ended. Success closes the item; a failed check reopens it
-- on the step that was just answered, without that answer, and tells Claude why.
create or replace function public.cmo_inbox_finish(p_run uuid, p_ok boolean, p_feedback text default null)
returns public.cmo_inbox
language plpgsql security definer set search_path = public
as $$
declare
  v_run public.cmo_runs;
  v_item public.cmo_inbox;
begin
  select * into v_run from public.cmo_runs where id = p_run;
  if not found or nullif(v_run.input->>'inbox', '') is null then
    return null;
  end if;
  if p_ok then
    update public.cmo_inbox set status = 'done', finished_at = now(), feedback = null
    where id = (v_run.input->>'inbox')::uuid and user_id = v_run.user_id and status = 'submitted' and run_id = p_run
    returning * into v_item;
  else
    update public.cmo_inbox
    set status = case when rounds >= public.cmo_inbox_max_rounds() then 'expired' else 'open' end,
        answers = answers - step, claimed_at = null,
        finished_at = case when rounds >= public.cmo_inbox_max_rounds() then now() end,
        feedback = left(coalesce(p_feedback, 'The answer did not pass our checks.'), 1000)
    where id = (v_run.input->>'inbox')::uuid and user_id = v_run.user_id and status = 'submitted' and run_id = p_run
    returning * into v_item;
  end if;
  return v_item;
end;
$$;

-- The founder's items still waiting for an answer (or for the replay), newest first. The request
-- itself is large: inbox_claim returns it for one item.
create or replace function public.inbox_list()
returns table (id uuid, kind text, step text, title text, status text, feedback text, rounds integer, created_at timestamptz, expires_at timestamptz, run_id uuid)
language sql stable security definer set search_path = public
as $$
  select i.id, i.kind, i.step, left(i.request->>'title', 200),
         case when i.status in ('open', 'claimed') and i.expires_at <= now() then 'expired' else i.status end,
         i.feedback, i.rounds, i.created_at, i.expires_at, i.run_id
  from public.cmo_inbox i
  where i.user_id = public.require_user()
    and (i.status in ('open', 'claimed', 'submitted') or i.finished_at > now() - interval '1 day')
  order by i.created_at desc
  limit 50;
$$;

-- Claude takes one item to work on. Claiming again is allowed (a new chat, a lost context); an
-- item already submitted or closed is returned as it is, for its status.
create or replace function public.inbox_claim(p_id uuid)
returns public.cmo_inbox
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.cmo_inbox;
begin
  select * into v_item from public.cmo_inbox where id = p_id and user_id = public.require_user() for update;
  if not found then
    raise exception 'Inbox item not found.' using errcode = 'P0002';
  end if;
  if v_item.status in ('open', 'claimed') and v_item.expires_at <= now() then
    update public.cmo_inbox set status = 'expired', finished_at = now() where id = p_id returning * into v_item;
  elsif v_item.status in ('open', 'claimed') then
    update public.cmo_inbox set status = 'claimed', claimed_at = now() where id = p_id returning * into v_item;
  end if;
  return v_item;
end;
$$;

-- Claude's answer for the item's current step. Idempotent by request id: the same submission sent
-- twice returns the item without a second replay. The answer was validated against the job's zod
-- schema before this call; here only its shape and size, and the replay validates it again.
create or replace function public.inbox_submit(p_id uuid, p_request_id uuid, p_step text, p_answer jsonb)
returns public.cmo_inbox
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_item public.cmo_inbox;
  v_run public.cmo_runs;
begin
  if p_request_id is null or p_answer is null or jsonb_typeof(p_answer) <> 'object' or octet_length(p_answer::text) > 131072 then
    raise exception 'This answer is not valid.' using errcode = '22023';
  end if;
  select * into v_item from public.cmo_inbox where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Inbox item not found.' using errcode = 'P0002';
  end if;
  if v_item.last_request_id = p_request_id then
    return v_item;
  end if;
  if v_item.status not in ('open', 'claimed') or v_item.expires_at <= now() then
    raise exception 'This inbox item is no longer waiting for an answer.' using errcode = 'P0001';
  end if;
  if v_item.step <> p_step then
    raise exception 'This inbox item now waits for step "%". Read it again.', v_item.step using errcode = 'P0001';
  end if;
  if v_item.rounds >= public.cmo_inbox_max_rounds() then
    raise exception 'This inbox item took too many answers. It will come back with the next schedule.' using errcode = 'P0001';
  end if;

  insert into public.cmo_runs (user_id, kind, status, input, credits)
  values (v_user, v_item.kind, 'queued', v_item.input || jsonb_build_object('brain', 'claude', 'inbox', v_item.id), 0)
  returning * into v_run;

  update public.cmo_inbox
  set answers = answers || jsonb_build_object(p_step, p_answer), status = 'submitted', submitted_at = now(),
      rounds = rounds + 1, last_request_id = p_request_id, feedback = null, run_id = v_run.id
  where id = p_id
  returning * into v_item;
  return v_item;
end;
$$;

revoke all on function public.cmo_inbox_open(uuid, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.cmo_inbox_open(uuid, integer, text, jsonb, jsonb) to service_role;
revoke all on function public.cmo_inbox_finish(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.cmo_inbox_finish(uuid, boolean, text) to service_role;
revoke all on function public.inbox_list() from public, anon;
grant execute on function public.inbox_list() to authenticated;
revoke all on function public.inbox_claim(uuid) from public, anon;
grant execute on function public.inbox_claim(uuid) to authenticated;
revoke all on function public.inbox_submit(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.inbox_submit(uuid, uuid, text, jsonb) to authenticated;

commit;
