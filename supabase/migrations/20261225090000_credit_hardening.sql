-- Credit system review 2026-10-22, after #104 and #107:
-- 1. Cancelling keeps credits only once the worker has sent the paid request (`generations.sent_at`, set by
--    `mark_generation_sent` right before the provider call), not from the moment it claims the task. A
--    reclaimed task that had reached the provider keeps them too.
-- 2. `create_generation` has its own rate limit (`generation_create`, 120 an hour of new generations): the
--    route's `generations` bucket is skipped by a direct PostgREST call, and the worker's prompt check is paid.
-- 3. A Polar payment credited through our checkout's external id maps its customer to the account, so that
--    customer's later events (refunds, cancelled subscriptions) are not skipped. An account can have several.
-- 4. The hourly write budget counts only what the user wrote (`write_budget_ledger`), not the transcripts and
--    revisions the worker and server add to the same clips.

begin;

alter table public.generations add column if not exists sent_at timestamptz;

create or replace function public.mark_generation_sent(p_task_id uuid, p_attempt_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rows int;
begin
  -- Locks the task first, as the cancel path does, so a cancel either lands before (false: the worker
  -- stops without paying) or after (the credits stay spent).
  perform 1 from public.tasks
  where id = p_task_id and kind = 'generate' and status = 'running' and attempt_id is not distinct from p_attempt_id
  for update;
  if not found then return false; end if;
  update public.generations set sent_at = coalesce(sent_at, now())
  where task_id = p_task_id and status = 'running';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke execute on function public.mark_generation_sent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_generation_sent(uuid, uuid) to service_role;

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
  elsif new.status = 'cancelled' and v_generation.sent_at is not null then
    -- The worker sent the paid request (`mark_generation_sent`, right before the provider call):
    -- cancelling stops the result, not the bill. Until then nothing was paid, so a cancel while the
    -- worker downloads or checks inputs is refunded below, and so is one after a reclaim that never
    -- reached the provider; a reclaimed task that had reached it keeps its credits even when queued.
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
      -- `create_generation` itself: a direct PostgREST call skips the route's bucket.
      or (p_bucket = 'generation_create' and p_limit = 120 and p_window_seconds = 3600)
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

create or replace function public.create_generation(p_job_id uuid, p_clip_id uuid, p_model text, p_spec jsonb, p_spec_hash text, p_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := public.require_user();
  v_model public.ai_models;
  v_generation public.generations;
  v_task public.tasks;
  v_price int;
  v_parent public.generations;
begin
  if p_request_id is null then
    raise exception 'Missing request id.' using errcode = '22023';
  end if;
  if p_spec_hash is null or p_spec_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid generation request.' using errcode = '22023';
  end if;
  -- Khoá theo người dùng: kiểm số dư, trần đang chạy và trùng hash phải đọc
  -- một trạng thái mà hai request song song không cùng thấy.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 2905));

  -- Gửi lại cùng request id (mạng rớt sau khi server đã ghi) → trả lại đúng lượt đó.
  select g.* into v_generation from public.generations g
  join public.tasks t on t.id = g.task_id
  where t.request_id = p_request_id and g.user_id = v_user;
  if found then
    return jsonb_build_object('generation', to_jsonb(v_generation), 'reused', true);
  end if;
  if exists (select 1 from public.tasks where request_id = p_request_id) then
    raise exception 'That request id was already used.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.jobs
    where id = p_job_id and user_id = v_user and purging_at is null
  ) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_clip_id is not null and not exists (
    select 1 from public.clips where id = p_clip_id and job_id = p_job_id
  ) then
    raise exception 'Clip not found.' using errcode = 'P0002';
  end if;

  select * into v_model from public.ai_models where id = p_model and enabled;
  if not found then
    raise exception 'This model is not available.' using errcode = '22023';
  end if;
  perform public.ai_check_spec(v_model, p_spec);

  -- A finished generation whose file was deleted from the library cannot be reused: Retry would
  -- return it forever, with no file. Its hash is retired (still 64 hex characters) so a new one can
  -- be made; a shot continuing it then waits for the new one like for any parent.
  update public.generations
  set spec_hash = encode(sha256(convert_to(spec_hash || ':retired:' || id::text, 'UTF8')), 'hex')
  where job_id = p_job_id and spec_hash = p_spec_hash and status = 'done' and media_asset_id is null;

  select * into v_generation from public.generations
  where job_id = p_job_id and spec_hash = p_spec_hash and status in ('queued', 'running', 'done');
  if found then
    return jsonb_build_object('generation', to_jsonb(v_generation), 'reused', true);
  end if;

  -- New generations only (reuse returned above): each one runs a paid prompt check on the worker, and a
  -- blocked prompt is refunded in full, so the web's `generations` limit alone left a free loop open.
  if not public.rate_limit_hit('generation_create', 120, 3600) then
    raise exception 'Too many generations started. Wait a while and try again.' using errcode = 'P0001';
  end if;

  if (select count(*) from public.generations
      where user_id = v_user and status in ('queued', 'running')) >= public.generation_active_limit() then
    raise exception 'Too many generations are running. Wait for one to finish.' using errcode = 'P0001';
  end if;

  v_price := public.ai_price(v_model, p_spec);
  if public.credit_balance(v_user) < v_price then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_price, public.credit_balance(v_user) using errcode = 'P0001';
  end if;

  -- A shot that continues another (`after`) waits for it: same project and owner, still live.
  -- The row lock orders this against `complete_generation`, which releases waiting children.
  if p_spec ? 'after' then
    select * into v_parent from public.generations
    where job_id = p_job_id and user_id = v_user and spec_hash = p_spec->>'after'
      and status in ('queued', 'running', 'done')
    for update;
    if not found then
      raise exception 'Start the shot before this one first.' using errcode = '22023';
    end if;
  end if;

  insert into public.generations (user_id, job_id, clip_id, kind, model, spec, spec_hash, credits_reserved, after_id)
  values (v_user, p_job_id, p_clip_id, v_model.kind, v_model.id, p_spec, p_spec_hash, v_price, v_parent.id)
  returning * into v_generation;
  insert into public.tasks (user_id, kind, job_id, clip_id, payload, request_id, status)
  values (v_user, 'generate', p_job_id, p_clip_id, jsonb_build_object('generation_id', v_generation.id), p_request_id,
          case when v_parent.id is not null and v_parent.status <> 'done' then 'awaiting_input' else 'queued' end)
  returning * into v_task;
  update public.generations set task_id = v_task.id where id = v_generation.id returning * into v_generation;
  if v_price > 0 then
    perform public.credit_hold(v_user, 'generation', v_generation.id, v_price, 'Generate hold', p_job_id);
  end if;

  return jsonb_build_object('generation', to_jsonb(v_generation), 'reused', false);
end;
$_$;

alter table public.polar_customers drop constraint if exists polar_customers_user_id_key;
create index if not exists polar_customers_user_idx on public.polar_customers (user_id);

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
   -- Map the second customer too: its later events (a refund, a cancelled subscription) may carry no
   -- external id, and the email path would skip them as "account already linked".
   insert into public.polar_customers(customer_id,user_id) values(v_customer,v_user) on conflict (customer_id) do nothing;
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

create table if not exists public.write_budget_ledger (
  user_id uuid not null references public.profiles(id) on delete cascade,
  table_name text not null,
  bytes bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists write_budget_ledger_user_idx on public.write_budget_ledger (user_id, table_name, created_at);
alter table public.write_budget_ledger enable row level security;
revoke all on public.write_budget_ledger from public, anon, authenticated;
grant select, insert, update, delete on public.write_budget_ledger to service_role;

-- A signed-in user's writes of large rows, per table and per hour. PostgREST lets any signed-in user call
-- the RPCs that insert these rows directly, past the routes' rate limits, and nothing ever trims the tables:
-- without a cap one account fills the shared database. Only writes with `auth.uid()` are recorded in the
-- ledger, so the worker's and server's rows on the same clips (paid work) never count against the user.
-- Duplicates (`on conflict do nothing`) count too.
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
  v_size bigint;
begin
  if v_user is null then
    return new;
  end if;
  -- Serialised per user and table, so parallel calls cannot all pass the same check.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':write-budget:' || tg_table_name, 0));
  -- Statements, not a CASE expression: plpgsql resolves every `new.<field>` in an expression on each table.
  if tg_table_name = 'editor_transcripts' then
    v_size := octet_length(new.body);
  elsif tg_table_name = 'editor_revisions' then
    v_size := pg_column_size(new.document);
  else
    v_size := pg_column_size(new.body);
  end if;
  delete from public.write_budget_ledger
  where user_id = v_user and table_name = tg_table_name and created_at <= now() - interval '1 hour';
  select count(*), coalesce(sum(bytes), 0) into v_rows, v_bytes
  from public.write_budget_ledger where user_id = v_user and table_name = tg_table_name;
  if v_rows >= public.write_budget_rows(tg_table_name) or v_bytes + v_size > public.write_budget_bytes() then
    raise exception 'You have saved a lot of changes in the last hour. Wait a few minutes and try again.'
      using errcode = 'P0001';
  end if;
  insert into public.write_budget_ledger (user_id, table_name, bytes) values (v_user, tg_table_name, v_size);
  return new;
end;
$$;

revoke execute on function public.enforce_write_budget() from public, anon, authenticated;

commit;
