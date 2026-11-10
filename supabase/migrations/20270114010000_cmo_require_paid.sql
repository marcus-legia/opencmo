-- CMO review 3, B0: the one paywall rule (plan §3.1). The first run is free; the first action that sends something out
-- or costs credits again asks for a plan. Every place that asks calls this function, so "paid" has one definition.
--
-- Paid = a plan on sale (`is_paid`) or credits left from before paid-first (a pack, a refund, an old signup gift), the
-- same rule `lib/paid-first.ts` used. Credits are only ever bought, so a free first run never makes an account "paid".
--
-- SQLSTATE P0402 is ours alone: `lib/api/errors.ts` maps it to HTTP 402 with the code `plan_required`, and the web
-- answers it with the plan sheet. A founder can only ask about themselves; the service role (no `auth.uid()`) can ask
-- about anyone.

-- Internal: whether an account counts as paid. No ownership check, so it is not callable by founders (`is_paid` hides
-- another account's plan; this one would not). SQL that decides for a user it already trusts (`cmo_enqueue`,
-- `start_cmo_run`, `cmo_first_run_free`) calls it; a founder asks through `cmo_require_paid`.
create or replace function public.cmo_paid(p_user uuid) returns boolean
  language sql stable security definer
  set search_path to ''
as $$
  select coalesce((select p.plan in ('starter', 'creator') or p.credit_balance > 0 from public.profiles p where p.id = p_user), false);
$$;

revoke all on function public.cmo_paid(uuid) from public, anon, authenticated;
grant execute on function public.cmo_paid(uuid) to service_role;

-- Internal: the one refusal, so every caller says the same thing with the same code.
create or replace function public.cmo_plan_required() returns void
  language plpgsql
  set search_path to ''
as $$
begin
  raise exception 'Pick a plan to keep going. Your first plan and drafts stay here.' using errcode = 'P0402';
end;
$$;

revoke all on function public.cmo_plan_required() from public, anon, authenticated;

create or replace function public.cmo_require_paid(p_user uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if p_user is null or (auth.uid() is not null and auth.uid() <> p_user) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if not public.cmo_paid(p_user) then
    perform public.cmo_plan_required();
  end if;
end;
$$;

revoke all on function public.cmo_require_paid(uuid) from public, anon;
grant execute on function public.cmo_require_paid(uuid) to authenticated, service_role;
