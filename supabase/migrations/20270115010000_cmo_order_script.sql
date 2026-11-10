-- CMO review 3, I0 (plan §8): the CMO chat orders a script. Until now `create_task` with agent `video` only added a
-- calendar item with an "Upload video" button; only the Sunday plan wrote scripts (C1). Asked in the chat, the CMO now
-- orders the same thing the week plan orders for a video item, in one transaction:
--   1. the calendar item (`cmo_add_item`: the founder's own, with its limits);
--   2. the `write_video_brief` order on this week's root, budgeted as `work_orders_plan_week` budgets one;
--   3. the Writer run, which holds the price (`cmo_enqueue`: the paywall and the credit hold).
-- Unlike `writer_order_start`, a refusal here (no plan, no credits, the daily cap) is not swallowed into a failed order:
-- the whole order rolls back and the chat says why. The script card is raised when Writer finishes, as for the week
-- plan's scripts (`work_orders_brief_rules`); the founder makes the video (owner, 2026-11-09), nothing builds it.

create or replace function public.cmo_order_script(p_brief text, p_day date default null, p_brain text default null)
returns jsonb
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_item public.content_items;
  v_root public.work_orders;
  v_order public.work_orders;
  v_run public.cmo_runs;
  v_free integer;
  v_price integer := public.cmo_job_price('write_video_brief');
  v_input jsonb;
begin
  if p_brain is not null and p_brain <> 'claude' then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  v_item := public.cmo_add_item('video', p_brief, coalesce(p_day, current_date), 'Asked in the CMO chat', '{}'::jsonb);
  v_root := public.work_order_week_root(v_user);
  v_free := v_root.budget_credits - v_root.spent_credits - coalesce((
    select sum(budget_credits - spent_credits) from public.work_orders
    where parent_id = v_root.id and status not in ('done', 'failed', 'cancelled')), 0);
  v_order := public.work_order_create(v_user, v_root.week, v_root.id, 'write_video_brief',
    left('Script for “' || v_item.idea || '”', 200),
    jsonb_build_object('objective', v_item.idea, 'reason', 'Asked in the CMO chat', 'platform', v_item.platform,
      'done_when', 'The founder approved the script.'),
    least(v_price, greatest(v_free, 0)), (v_item.day + interval '23 hours 59 minutes') at time zone 'UTC', '{}', 'chat',
    v_item.id);
  v_input := jsonb_build_object('idea', v_item.idea, 'reason', 'Asked in the CMO chat', 'seconds', public.cmo_video_seconds(),
    'aspect', '9:16', 'platform', v_item.platform, 'order_id', v_order.id, 'source', 'chat')
    || case when p_brain = 'claude' then '{"brain": "claude"}'::jsonb else '{}'::jsonb end;
  v_run := public.cmo_enqueue(v_user, 'write_video_brief', v_input);
  return jsonb_build_object('item_id', v_item.id, 'order_id', v_order.id, 'run_id', v_run.id, 'status', v_run.status,
    'day', v_item.day, 'credits', v_run.credits);
end;
$$;

revoke all on function public.cmo_order_script(text, date, text) from public, anon;
grant execute on function public.cmo_order_script(text, date, text) to authenticated, service_role;
