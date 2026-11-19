-- Wave 4a A1 (docs/plans/cmo/2026-11-20-wave4-plan.md, task 2): one read for the "100% used" and "free scan used"
-- states the screens show.
--
-- `my_usage_state()` wraps `plan_usage_for` (the fair-use bar, 20270131020000) and `cmo_first_run_free` (the free
-- scan) into one answer: the plan, the share used, whether included work is stopped (`blocked`) and why, which work
-- stopped, what still works, and when the period resets. It only reads: no new money path, nothing renamed. The
-- refusals themselves stay where they are (`cmo_usage_paused_check`, `cmo_require_paid`); this tells the screen what
-- they will say before the founder clicks.
--
-- Keys in `stopped` and `still_works` are stable ids; the screens write the words.

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

revoke all on function public.my_usage_state() from public, anon;
grant execute on function public.my_usage_state() to authenticated, service_role;
