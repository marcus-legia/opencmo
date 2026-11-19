-- Review of #241 (wave 4a): two fixes to the functions of 20270202010000 and 20270202020000. Both only replace a
-- function body: the code in production keeps working before the merge.
--
-- 1. `my_usage_state`: a free account whose three free scans all failed read as "free scan used" (blocked, "you have
--    seen who is asking") with nothing ever found. It is now `free_scan = 'failed'`, not blocked.
-- 2. `account_delete`: an open deletion row left by the unpaid cleanup kept a founder's own request out of the
--    self-deletion retry. The founder's request now takes the open row over.

create or replace function public.my_usage_state()
returns jsonb
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_usage record;
  v_paid boolean;
  v_free_scan text;
  v_blocked boolean := false;
  v_reason text;
  v_stopped text[] := '{}';
  v_works text[] := array['read', 'edit', 'copy_drafts'];
begin
  select * into v_usage from public.plan_usage_for(v_user);
  v_paid := public.cmo_paid(v_user);

  if v_usage.plan = 'pro' then
    if v_usage.paused then
      -- `cmo_usage_paused_check` refuses these kinds at 100%; drafts of what the founder already has still run.
      v_blocked := true;
      v_reason := 'allowance_used';
      v_stopped := array['sales_scan', 'research'];
      v_works := v_works || array['post_drafts', 'reply_drafts'];
    else
      v_works := v_works || array['sales_scan', 'research', 'post_drafts', 'reply_drafts'];
    end if;
  elsif not v_paid then
    v_free_scan := case
      when exists (select 1 from public.cmo_runs r
                   where r.user_id = v_user and r.kind = 'sales_scan' and r.status in ('queued', 'running'))
        then 'running'
      when public.cmo_first_run_free(v_user, 'sales_scan') then 'available'
      when not exists (select 1 from public.cmo_runs r
                       where r.user_id = v_user and r.kind = 'sales_scan' and r.status = 'done')
           and not exists (select 1 from public.marketing_documents d
                           where d.user_id = v_user and d.kind = 'product')
        -- Onboarding has not written the product document yet: the free scan is still to come.
        then 'not_ready'
      -- Review of #241: three failed runs also end the free run (`cmo_first_run_free`), but nothing was found, so it
      -- is not "used": the screens lock nothing and the scan's own refusal says what happened.
      when not exists (select 1 from public.cmo_runs r
                       where r.user_id = v_user and r.kind = 'sales_scan' and r.status = 'done')
        then 'failed'
      else 'used'
    end;
    if v_free_scan = 'used' then
      v_blocked := true;
      v_reason := 'free_scan_used';
      v_stopped := array['sales_scan', 'reply_drafts'];
    end if;
    if public.cmo_first_run_free(v_user, 'post_draft') then
      v_works := v_works || array['post_drafts'];
    elsif v_blocked then
      v_stopped := v_stopped || array['post_drafts'];
    end if;
  end if;

  return jsonb_build_object(
    'plan', v_usage.plan,
    'interval', v_usage."interval",
    'used', v_usage.used,
    'allowance', v_usage.allowance,
    'percent', v_usage.percent,
    'resets_at', v_usage.resets_at,
    'blocked', v_blocked,
    'reason', v_reason,
    'stopped', to_jsonb(v_stopped),
    'still_works', to_jsonb(v_works),
    'free_scan', v_free_scan
  );
end;
$$;

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

  -- An open row from the unpaid cleanup (its `deleteUser` failed, then the account paid) would keep this request out
  -- of the self-deletion retry: the founder's own request takes it over (review of #241).
  insert into public.account_deletions (user_id, source) values (v_user, 'self')
  on conflict (user_id) where done_at is null do update set source = 'self';
  v_files := public.account_purge_files(v_user);

  return jsonb_build_object('user_id', v_user, 'files', v_files);
end;
$$;
