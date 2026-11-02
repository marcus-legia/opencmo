-- P2 review fixes that touch wave 1's functions, and the usage ledger of the brain's Studio orders.
--
-- 1. `work_order_create` refused even a 0-credit child once its parent had nothing left to hand out (spending past
--    a budget is recorded, never refused, so `v_free` goes negative in normal use): only a child that asks for
--    credits is checked against what is free.
-- 2. The brain's Director and Clip editor calls are charged by their real tokens, the way Assistant turns are
--    (`agent_micro_usd` → `agent_credits`): each call is a `work_order_usage` row, and the order's running total is
--    settled on the credit ledger under `ref_kind = 'work_order'` (cumulative, so small calls are not each rounded up).

create or replace function public.work_order_create(p_user uuid, p_week date, p_parent uuid, p_kind text, p_title text,
  p_brief jsonb default '{}'::jsonb, p_budget integer default 0, p_due timestamptz default null,
  p_depends_on uuid[] default '{}', p_created_by text default 'loop', p_item uuid default null,
  p_department text default null)
returns public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_parent public.work_orders;
  v_row public.work_orders;
  v_free integer;
begin
  if p_parent is not null then
    select * into v_parent from public.work_orders where id = p_parent and user_id = p_user for update;
    if not found then
      raise exception 'Parent order not found.' using errcode = 'P0002';
    end if;
    v_free := v_parent.budget_credits - v_parent.spent_credits - coalesce((
      select sum(budget_credits - spent_credits) from public.work_orders
      where parent_id = p_parent and status not in ('done', 'failed', 'cancelled')), 0);
    if coalesce(p_budget, 0) > 0 and p_budget > v_free then
      raise exception 'The parent order has % credits left to hand out.', greatest(v_free, 0) using errcode = 'P0001';
    end if;
  end if;
  if exists (select 1 from unnest(coalesce(p_depends_on, '{}')) d(id)
             where not exists (select 1 from public.work_orders o where o.id = d.id and o.user_id = p_user)) then
    raise exception 'An order can only wait on the founder''s own orders.' using errcode = '22023';
  end if;
  insert into public.work_orders (user_id, root_id, parent_id, week, depends_on, department, kind, title, brief,
    budget_credits, due_at, created_by, item_id)
  values (p_user, coalesce(v_parent.root_id, v_parent.id), p_parent, coalesce(v_parent.week, p_week),
    coalesce(p_depends_on, '{}'), coalesce(p_department, public.work_order_department(p_kind)), p_kind,
    left(coalesce(nullif(trim(p_title), ''), p_kind), 200), coalesce(p_brief, '{}'::jsonb), coalesce(p_budget, 0),
    p_due, p_created_by, p_item)
  returning * into v_row;
  if p_parent is null then
    update public.work_orders set root_id = id where id = v_row.id returning * into v_row;
  end if;
  perform public.work_order_event(v_row, 'created', 'Planned “' || v_row.title || '”');
  return v_row;
end;
$$;

alter table public.credit_ledger drop constraint credit_ledger_ref_kind_check;
alter table public.credit_ledger add constraint credit_ledger_ref_kind_check
  check (ref_kind in ('job', 'generation', 'captions', 'caption_translation', 'agent_turn', 'cmo_run', 'work_order'));

create table public.work_order_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.work_orders(id) on delete cascade,
  model text not null check (char_length(model) between 1 and 64),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cache_read_tokens integer not null check (cache_read_tokens >= 0),
  cache_write_tokens integer not null check (cache_write_tokens >= 0),
  micro_usd bigint not null check (micro_usd >= 0),
  created_at timestamptz not null default now()
);
create index work_order_usage_order_idx on public.work_order_usage (order_id);
alter table public.work_order_usage enable row level security;
create policy "read own order usage" on public.work_order_usage for select to authenticated using (user_id = auth.uid());
revoke all on public.work_order_usage from anon, authenticated;
grant select on public.work_order_usage to authenticated;
grant select, insert, update, delete on public.work_order_usage to service_role;

-- One model call of the brain's Studio team, under the founder's brain session. Returns the order's credits so far.
-- Short of balance, it charges what is left (the call already ran), as Assistant usage after Stop does.
create or replace function public.studio_record_usage(p_order_id uuid, p_model text, p_input integer, p_output integer,
  p_cache_read integer, p_cache_write integer)
returns integer language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_total bigint;
  v_credits integer;
  v_held integer;
  v_charge integer;
begin
  if not public.studio_brain_call() then
    raise exception 'Only OpenCMO''s Studio team can do this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.work_orders where id = p_order_id and user_id = v_user and kind in ('build_video', 'cut_shorts')) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if p_input is null or p_output is null or p_cache_read is null or p_cache_write is null
     or least(p_input, p_output, p_cache_read, p_cache_write) < 0 then
    raise exception 'Invalid usage.' using errcode = '22023';
  end if;
  perform public.lock_credit_owner(v_user);
  insert into public.work_order_usage (user_id, order_id, model, input_tokens, output_tokens, cache_read_tokens,
    cache_write_tokens, micro_usd)
  values (v_user, p_order_id, left(coalesce(nullif(p_model, ''), 'unknown'), 64), p_input, p_output, p_cache_read, p_cache_write,
    public.agent_micro_usd(p_model, p_input, p_output, p_cache_read, p_cache_write));
  select coalesce(sum(micro_usd), 0)::bigint into v_total from public.work_order_usage where order_id = p_order_id;
  v_credits := public.agent_credits(v_total);
  v_held := public.credit_held('work_order', p_order_id);
  if v_credits > v_held then
    v_charge := least(v_credits - v_held, greatest(public.credit_balance(v_user), 0));
    if v_charge > 0 then
      perform public.credit_settle(v_user, 'work_order', p_order_id, v_held + v_charge, 'CMO video team usage');
      perform public.work_order_spend(p_order_id, v_charge);
    end if;
  end if;
  return v_credits;
end;
$$;
revoke all on function public.studio_record_usage(uuid, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.studio_record_usage(uuid, text, integer, integer, integer, integer) to authenticated;
