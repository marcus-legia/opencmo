-- Security review 2026-10-22: abuse paths a signed-in user reaches by calling RPCs
-- through PostgREST directly, past the checks that only the web routes made.
-- 1. A generation cancelled while `running` keeps its credits: the provider was already paid.
-- 2. `refund_caption_translation` is service-role only: a user refunded a translation mid LLM call.
-- 3. `retry_job` takes the same in-progress cap and rate limit as starting a project, and skips purged jobs.
-- 4. Large rows (transcripts, revisions, marketing documents) have a per-user hourly write budget, and MCP
--    confirm codes and new CMO conversations an hourly cap.
-- 5. A Polar order that carries our checkout's external id is credited even when the account is linked to
--    another Polar customer (it used to answer 200 "skipped" and drop the payment).
-- 6. `rate_limit_hit` takes the `generations` bucket. Same body as in 20261223100000_motion_clip.sql (PR #104),
--    so the order the two PRs merge in does not matter.

begin;

create or replace function public.sync_generation_from_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_generation public.generations;
begin
  if new.kind <> 'generate' or new.status is not distinct from old.status then
    return new;
  end if;
  select * into v_generation from public.generations where task_id = new.id for update;
  if not found or v_generation.status in ('done', 'failed', 'cancelled') then
    return new;
  end if;
  if new.status = 'running' then
    update public.generations set status = 'running' where id = v_generation.id;
  elsif new.status = 'queued' then
    update public.generations set status = 'queued' where id = v_generation.id;
  elsif new.status = 'cancelled' and old.status = 'running' then
    -- The worker had already sent the paid request to the provider: cancelling stops the
    -- result, not the bill. A full refund here made start-then-cancel a free provider loop.
    update public.generations
    set status = 'cancelled',
        credits_final = greatest(public.credit_held('generation', v_generation.id), 0),
        error = null,
        finished_at = now()
    where id = v_generation.id;
    update public.tasks
    set status = 'failed', error = 'The shot before this one did not finish. Your credits were refunded.',
        finished_at = now()
    where status = 'awaiting_input'
      and id in (select task_id from public.generations where after_id = v_generation.id);
  elsif new.status in ('failed', 'cancelled') then
    update public.generations
    set status = new.status,
        credits_final = 0,
        -- Lỗi chung của vòng lặp worker và của reclaim nói về "Rendering";
        -- người dùng đang sinh media, không render — thay bằng câu đúng việc.
        error = case when new.status = 'failed' then
          case when new.error is null or new.error ilike 'Rendering%'
            then 'Generation failed. Your credits were refunded.'
            else left(new.error, 500) end
        end,
        finished_at = now()
    where id = v_generation.id;
    perform public.credit_refund(v_generation.user_id, 'generation', v_generation.id, 'Generate refund', v_generation.job_id);
    -- Shots waiting to continue this one can never start: fail them too. Each runs this
    -- trigger in turn, so they are refunded and their own children follow.
    update public.tasks
    set status = 'failed', error = 'The shot before this one did not finish. Your credits were refunded.',
        finished_at = now()
    where status = 'awaiting_input'
      and id in (select task_id from public.generations where after_id = v_generation.id);
  end if;
  return new;
end;
$$;

create or replace function public.refund_caption_translation(p_charge_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_row public.caption_translations;
begin
  -- Called by the web server (service role) after its own LLM call failed. A user who could call it
  -- would refund a translation while the paid LLM call was still running.
  select * into v_row from public.caption_translations where id = p_charge_id for update;
  if not found or v_row.status <> 'charged' then
    return false;
  end if;
  update public.caption_translations set status = 'refunded' where id = v_row.id;
  perform public.credit_refund(v_row.user_id, 'caption_translation', v_row.id, 'Caption translation refund',
    (select job_id from public.clips where id = v_row.clip_id));
  return true;
end;
$$;

revoke execute on function public.refund_caption_translation(uuid) from public, anon, authenticated;
grant execute on function public.refund_caption_translation(uuid) to service_role;

create or replace function public.retry_job(p_job_id uuid) RETURNS public.jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_hold int := public.job_hold_credits();
  v_spent int;
  v_balance int;
  v_status public.job_status;
  v_job public.jobs;
begin
  -- Khoá hồ sơ TRƯỚC khi đọc số dư, đúng thứ tự của `create_job`: hai tab bấm
  -- Retry cùng lúc không được tiêu quá số dư.
  perform 1 from public.profiles where id = v_user for update;

  -- Same caps as create_upload_edit: the route's limit alone is skipped by calling this RPC directly.
  if (select count(*) from public.jobs
      where user_id = v_user and status in ('queued', 'running') and purging_at is null) >= 3
  then
    raise exception 'You already have 3 projects in progress. Please wait for one to finish.'
      using errcode = 'P0001';
  end if;
  if not public.rate_limit_hit('retry', 20, 3600) then
    raise exception 'Too many retries. Please wait a while and try again.'
      using errcode = 'P0001';
  end if;

  select status into v_status
  from public.jobs
  where id = p_job_id and user_id = v_user and purging_at is null
  for update;

  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if v_status not in ('failed', 'cancelled') then
    raise exception 'Only a failed project can be run again.' using errcode = '22023';
  end if;

  -- Lần chạy trước có thể đã được hoàn credit (`finalize_job_failure`). Giữ lại
  -- đúng phần còn thiếu để một job không bao giờ bị tính tiền hai lần.
  v_spent := public.job_credits_spent(p_job_id);
  if v_spent < v_hold then
    select coalesce(sum(delta), 0)::int into v_balance
    from public.credit_ledger where user_id = v_user;

    if v_balance < v_hold - v_spent then
      raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
        v_hold - v_spent, v_balance using errcode = 'P0001';
    end if;

    perform public.credit_hold(v_user, 'job', p_job_id, v_hold - v_spent, 'Hold for retry', p_job_id);
  end if;

  update public.jobs
  set status = 'queued',
      stage = 'queued',
      error = null,
      finished_at = null,
      -- attempt_id để null: worker của lần chạy cũ (nếu còn sống) ghi bằng
      -- attempt_id cũ sẽ bị mọi RPC có fence từ chối.
      attempt_id = null,
      lease_until = null,
      heartbeat_at = null,
      attempt_started_at = now(),
      call_id = null,
      attempt = 0
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- A signed-in user's writes of large rows, per table and per hour. PostgREST lets any signed-in user call
-- the RPCs that insert these rows directly, past the routes' rate limits, and nothing ever trims the tables:
-- without a cap one account fills the shared database. The worker and the server (service role, no
-- `auth.uid()`) are not counted: their writes are paid work. Duplicates (`on conflict do nothing`) count too.
create or replace function public.enforce_write_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_user uuid := auth.uid();
  v_rows int;
  v_bytes bigint;
begin
  if v_user is null then
    return new;
  end if;
  -- Serialised per user and table, so parallel calls cannot all pass the same check.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':write-budget:' || tg_table_name, 0));
  if tg_table_name = 'editor_transcripts' then
    select count(*), coalesce(sum(octet_length(t.body)), 0) into v_rows, v_bytes
    from public.jobs j join public.clips c on c.job_id = j.id join public.editor_transcripts t on t.clip_id = c.id
    where j.user_id = v_user and t.created_at > now() - interval '1 hour';
    v_bytes := v_bytes + octet_length(new.body);
  elsif tg_table_name = 'editor_revisions' then
    select count(*), coalesce(sum(pg_column_size(r.document)), 0) into v_rows, v_bytes
    from public.jobs j join public.clips c on c.job_id = j.id join public.editor_revisions r on r.clip_id = c.id
    where j.user_id = v_user and r.created_at > now() - interval '1 hour';
    v_bytes := v_bytes + pg_column_size(new.document);
  else
    select count(*), coalesce(sum(pg_column_size(m.body)), 0) into v_rows, v_bytes
    from public.marketing_documents m
    where m.user_id = v_user and m.created_at > now() - interval '1 hour';
    v_bytes := v_bytes + pg_column_size(new.body);
  end if;
  if v_rows >= public.write_budget_rows(tg_table_name) or v_bytes > public.write_budget_bytes() then
    raise exception 'You have saved a lot of changes in the last hour. Wait a few minutes and try again.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Generous for a person editing by hand (the editor route allows 240 writes a minute in short bursts), and
-- a hard ceiling for a script: at most 128 MB per table per hour instead of ~120 MB a minute.
create or replace function public.write_budget_rows(p_table text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $$
  select case p_table when 'marketing_documents' then 300 else 1200 end;
$$;

create or replace function public.write_budget_bytes()
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
AS $$
  select 128::bigint * 1024 * 1024;
$$;

revoke execute on function public.enforce_write_budget() from public, anon, authenticated;
revoke execute on function public.write_budget_rows(text) from public, anon, authenticated;
revoke execute on function public.write_budget_bytes() from public, anon, authenticated;

create index if not exists editor_transcripts_clip_created_idx on public.editor_transcripts (clip_id, created_at);
create index if not exists editor_revisions_clip_created_idx on public.editor_revisions (clip_id, created_at);
create index if not exists marketing_documents_user_created_idx on public.marketing_documents (user_id, created_at);

drop trigger if exists editor_transcripts_write_budget on public.editor_transcripts;
create trigger editor_transcripts_write_budget before insert on public.editor_transcripts
  for each row execute function public.enforce_write_budget();
drop trigger if exists editor_revisions_write_budget on public.editor_revisions;
create trigger editor_revisions_write_budget before insert on public.editor_revisions
  for each row execute function public.enforce_write_budget();
drop trigger if exists marketing_documents_write_budget on public.marketing_documents;
create trigger marketing_documents_write_budget before insert on public.marketing_documents
  for each row execute function public.enforce_write_budget();

create or replace function public.process_polar_event(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_data jsonb, p_purchase_plan text, p_credits integer, p_entitlement_plan text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
 v_customer text := coalesce(nullif(p_data->>'customer_id',''),nullif(p_data#>>'{customer,id}',''));
 v_email text := coalesce(p_data#>>'{customer,email}',p_data#>>'{user,email}',p_data->>'customer_email');
 -- `customer_external_id` do link checkout của ta gắn vào (`app/app/billing`).
 -- Nó là `profiles.id`, nên khớp bằng nó là khớp CHẮC; email chỉ là đường lùi
 -- cho những lần mua không đi qua link của ta.
 v_external text := coalesce(
   nullif(p_data#>>'{customer,external_id}',''),
   nullif(p_data->>'customer_external_id',''),
   nullif(p_data#>>'{customer,metadata,user_id}','')
 );
 v_external_user uuid;
 v_id text := nullif(p_data->>'id','');
 v_user uuid; v_link text; v_result jsonb; v_purchase public.polar_purchases%rowtype;
 v_sub jsonb; v_sub_id text; v_status text; v_version timestamptz; v_priority integer;
 v_granted integer := 0; v_rows integer; v_plan text;
begin
 if v_customer is null and nullif(v_email,'') is null and v_external is null then
  return jsonb_build_object('ok',true,'skipped','no email on event');
 end if;
 if p_event_id is null or p_event_id='' or p_event_at is null or v_id is null or v_customer is null then
  raise exception 'Invalid billing event.' using errcode='22023';
 end if;
 if p_event_type not in ('order.paid','order.refunded','subscription.active','subscription.canceled','subscription.revoked','subscription.past_due') then
  return jsonb_build_object('ok',true,'ignored',p_event_type);
 end if;
 if nullif(p_data#>>'{customer,id}','') is not null and p_data#>>'{customer,id}'<>v_customer then
  raise exception 'Conflicting billing customer.' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('polar:event:'||p_event_id,0));
 select result into v_result from public.polar_webhook_receipts where event_id=p_event_id;
 if found then return v_result || jsonb_build_object('duplicate',true,'credits',0); end if;
 perform pg_advisory_xact_lock(hashtextextended('polar:customer:'||v_customer,0));
 select user_id into v_user from public.polar_customers where customer_id=v_customer;
 if found then
  if v_user is null then return jsonb_build_object('ok',true,'skipped','account no longer exists'); end if;
  perform 1 from public.profiles where id=v_user for update;
  if not found then return jsonb_build_object('ok',true,'skipped','account no longer exists'); end if;
 else
  -- Khớp bằng external_id TRƯỚC. Email là chuỗi người mua tự gõ ở trang Polar;
  -- gõ khác email đăng nhập là tiền vào mà credit không bao giờ cộng, và route
  -- trả 200 nên Polar không gửi lại. `external_id` do ta gắn vào link checkout
  -- nên không có chỗ cho người dùng gõ sai.
  --
  -- Ép kiểu có canh regex: `external_id` là chuỗi tuỳ ý bên Polar, và một giá
  -- trị không phải uuid sẽ ném lỗi 22P02 — tức 500 và Polar retry vĩnh viễn.
  if v_external is not null
     and v_external ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then
   select id,polar_customer_id into v_external_user,v_link
   from public.profiles where id=v_external::uuid for update;
   if found then v_user := v_external_user; end if;
  end if;

  if v_user is null then
   if nullif(v_email,'') is null then return jsonb_build_object('ok',true,'skipped','no email on event'); end if;
   if (select count(*) from public.profiles where lower(email)=lower(v_email))<>1 then
    return jsonb_build_object('ok',true,'skipped','no matching account');
   end if;
   select id,polar_customer_id into v_user,v_link from public.profiles where lower(email)=lower(v_email) for update;
  end if;

  if v_link is not null and v_link<>v_customer then
   -- A second Polar customer for the same account. Matched by email it proves nothing: skip. Matched by
   -- the external id our checkout link set, the payment is the account's: credit it, keep the first link.
   if v_external_user is null then return jsonb_build_object('ok',true,'skipped','account already linked'); end if;
   raise warning 'polar: order % for user % comes from customer %, account is linked to %', v_id, v_user, v_customer, v_link;
  else
   update public.profiles set polar_customer_id=v_customer where id=v_user;
   insert into public.polar_customers(customer_id,user_id) values(v_customer,v_user);
  end if;
 end if;
 if p_event_type in ('order.paid','order.refunded') then
  insert into public.polar_purchases(order_id,customer_id,user_id,product_id,total_amount,currency)
  values(v_id,v_customer,v_user,p_data->>'product_id',coalesce((p_data->>'total_amount')::bigint,0),p_data->>'currency') on conflict(order_id) do nothing;
  select * into v_purchase from public.polar_purchases where order_id=v_id for update;
  if v_purchase.customer_id<>v_customer or v_purchase.user_id is distinct from v_user then
   raise exception 'Purchase belongs to another account.' using errcode='22023';
  end if;
  if p_event_type='order.paid' then
   if p_purchase_plan is null or p_purchase_plan not in ('starter','creator') or p_credits is null or p_credits<=0 then
    raise exception 'Invalid paid product.' using errcode='22023';
   end if;
   if not v_purchase.granted then
    if exists(select 1 from public.credit_ledger where external_id='polar:'||v_id and user_id is distinct from v_user) then
     raise exception 'Purchase belongs to another account.' using errcode='22023';
    end if;
    insert into public.credit_ledger(user_id,delta,reason,external_id) values(v_user,p_credits,p_purchase_plan||' plan purchase','polar:'||v_id)
    on conflict(external_id) where external_id is not null do nothing;
    get diagnostics v_rows=row_count;
    if v_rows=1 then v_granted:=p_credits; end if;
    update public.polar_purchases set granted=true,credits=p_credits,plan=p_purchase_plan,paid_at=p_event_at where order_id=v_id;
   end if;
   v_sub:=p_data->'subscription'; v_sub_id:=nullif(v_sub->>'id',''); v_status:=v_sub->>'status';
   v_version:=coalesce((v_sub->>'modified_at')::timestamptz,(v_sub->>'created_at')::timestamptz,p_event_at);
  else
   if coalesce((p_data->>'refunded_amount')::bigint,0)<0 or coalesce((p_data->>'refunded_tax_amount')::bigint,0)<0 then
    raise exception 'Invalid refund amount.' using errcode='22023';
   end if;
   update public.polar_purchases set
    refunded_amount=greatest(refunded_amount,coalesce((p_data->>'refunded_amount')::bigint,0)),
    refunded_tax_amount=greatest(refunded_tax_amount,coalesce((p_data->>'refunded_tax_amount')::bigint,0)),
    refunded_at=greatest(refunded_at,p_event_at) where order_id=v_id;
  end if;
 else
  v_sub:=p_data; v_sub_id:=v_id; v_status:=substr(p_event_type,length('subscription.')+1);
  v_version:=coalesce((p_data->>'modified_at')::timestamptz,p_event_at);
 end if;
 if v_sub_id is not null and v_status in ('active','past_due','canceled','revoked')
  and (p_event_type<>'order.paid' or p_entitlement_plan is not null) then
  v_priority:=case v_status when 'active' then 0 when 'past_due' then 1 when 'canceled' then 2 else 3 end;
  perform pg_advisory_xact_lock(hashtextextended('polar:subscription:'||v_sub_id,0));
  if exists(select 1 from public.polar_subscriptions where subscription_id=v_sub_id and (customer_id<>v_customer or user_id is distinct from v_user)) then
   raise exception 'Subscription belongs to another account.' using errcode='22023';
  end if;
  select plan into v_plan from public.polar_subscriptions where subscription_id=v_sub_id;
  v_plan:=coalesce(p_entitlement_plan,v_plan);
  -- A retired product with no stored subscription has no entitlement to change.
  -- This branch is unreachable for paid orders because their plan is validated above.
  if v_plan is null then return jsonb_build_object('ok',true,'skipped','unmapped subscription product'); end if;
  if v_plan not in ('starter','creator') then raise exception 'Invalid subscription product.' using errcode='22023'; end if;
  insert into public.polar_subscriptions(subscription_id,customer_id,user_id,plan,status,current_period_end,provider_updated_at,status_priority,event_id)
  values(v_sub_id,v_customer,v_user,v_plan,v_status,(v_sub->>'current_period_end')::timestamptz,v_version,v_priority,p_event_id)
  on conflict(subscription_id) do update set plan=excluded.plan,status=excluded.status,
   current_period_end=coalesce(excluded.current_period_end,polar_subscriptions.current_period_end),
   provider_updated_at=excluded.provider_updated_at,status_priority=excluded.status_priority,event_id=excluded.event_id
  where (excluded.provider_updated_at,excluded.status_priority)>(polar_subscriptions.provider_updated_at,polar_subscriptions.status_priority)
   and polar_subscriptions.customer_id=excluded.customer_id and polar_subscriptions.user_id=excluded.user_id;
  select plan into v_plan from public.polar_subscriptions where user_id=v_user and status<>'revoked'
  order by case plan when 'creator' then 2 else 1 end desc limit 1;
  update public.profiles set plan=coalesce(v_plan,'free') where id=v_user;
 end if;
 v_result:=jsonb_build_object('ok',true,'credits',v_granted);
 insert into public.polar_webhook_receipts(event_id,event_type,occurred_at,user_id,result) values(p_event_id,p_event_type,p_event_at,v_user,v_result);
 return v_result;
end;
$_$;

create or replace function public.mcp_confirm_use(p_nonce uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_count int;
begin
  if p_nonce is null then
    raise exception 'That confirm code is not valid. Ask for the price again.' using errcode = '22023';
  end if;
  delete from public.mcp_confirms where user_id = v_user and used_at < now() - interval '1 day';
  if (select count(*) from public.mcp_confirms where user_id = v_user and used_at > now() - interval '1 hour') >= 600 then
    raise exception 'Too many confirm codes in the last hour. Try again later.' using errcode = 'P0001';
  end if;
  insert into public.mcp_confirms (user_id, nonce) values (v_user, p_nonce) on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.agent_open_cmo_session(p_model text, p_new boolean DEFAULT false) RETURNS public.agent_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_session public.agent_sessions;
begin
  if p_model is null or char_length(p_model) > 64 or not exists (
    select 1 from public.agent_model_prices p
    where p.allowed and p.pattern <> 'default' and p_model like p.pattern
  ) then
    raise exception 'Unknown assistant model.' using errcode = '22023';
  end if;
  if not coalesce(p_new, false) then
    select * into v_session from public.agent_sessions
    where user_id = v_user and scope = 'cmo' and model = p_model
    order by created_at desc limit 1;
    if found then
      return v_session;
    end if;
  end if;
  if (select count(*) from public.agent_sessions
      where user_id = v_user and scope = 'cmo' and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many new conversations in the last hour. Try again later.' using errcode = 'P0001';
  end if;
  insert into public.agent_sessions(user_id, scope, model)
  values (v_user, 'cmo', p_model) returning * into v_session;
  return v_session;
end;
$$;

create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_bucket text;
  v_plan text;
  v_quota record;
  v_expected int;
  v_window_start timestamptz;
  v_legacy_count int := 0;
  v_count int;
  v_allowed boolean := false;
begin
  v_bucket := case p_bucket
    when 'daily_preview' then 'preview'
    when 'daily_export' then 'export'
    else p_bucket
  end;

  if v_bucket in ('preview', 'export') then
    select coalesce(plan, 'free') into v_plan
    from public.profiles where id = v_user;
    select * into v_quota from public.plan_quota(v_plan);
    v_expected := case
      when v_bucket = 'preview' then v_quota.previews_per_day
      else v_quota.exports_per_day
    end;
    v_allowed := p_limit = v_expected and p_window_seconds = 86400;
    if p_bucket = 'preview' and p_limit = 2 and p_window_seconds = 60 then
      v_allowed := true;
    end if;
  else
    v_allowed := (p_bucket = 'presets' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'uploads' and p_limit = 30 and p_window_seconds = 3600)
      or (p_bucket = 'jobs' and p_limit = 10 and p_window_seconds = 3600)
      or (p_bucket = 'retry' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'draft' and p_limit = 120 and p_window_seconds = 60)
      or (p_bucket = 'project-write' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'mcp' and p_limit = 600 and p_window_seconds = 3600)
      or (p_bucket = 'editor-write' and p_limit = 240 and p_window_seconds = 60)
      or (p_bucket = 'zip' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'media' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'scene_codes' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'feedback' and p_limit = 20 and p_window_seconds = 3600)
      -- 30 until motion quality A3 (PR #104) raised MCP previews to 60: both, so either PR can merge first.
      or (p_bucket = 'mcp_preview' and p_limit = 30 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_preview' and p_limit = 60 and p_window_seconds = 3600)
      -- POST /api/v1/generations: each request can run a paid moderation call.
      or (p_bucket = 'generations' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_look' and p_limit = 60 and p_window_seconds = 3600);
  end if;

  if not v_allowed then
    raise exception 'Invalid rate limit.' using errcode = '22023';
  end if;

  -- The short preview/export window counts in its own row: in the first minute after UTC
  -- midnight the 60-second and the daily window share a `window_start`, and used to add up
  -- into the daily quota (CI red at 00:00:24 UTC on 04/10).
  if v_bucket in ('preview', 'export') and p_window_seconds <> 86400 then
    v_bucket := v_bucket || ':' || p_window_seconds;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  if v_bucket in ('preview', 'export') and p_window_seconds = 86400 then
    select coalesce(max(count), 0) into v_legacy_count
    from public.rate_limits
      where user_id = v_user
      and bucket = 'daily_' || v_bucket
      and window_start = v_window_start;
  end if;

  insert into public.rate_limits(user_id, bucket, window_start, count)
  values(v_user, v_bucket, v_window_start, v_legacy_count + 1)
  on conflict (user_id, bucket, window_start)
  do update set count = greatest(public.rate_limits.count, v_legacy_count) + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

commit;
