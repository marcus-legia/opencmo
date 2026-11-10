-- CMO review 3, B0: the one paywall rule (plan §3.1). The first run is free; the first action that sends something out
-- or costs credits again asks for a plan. Every place that asks calls this function, so "paid" has one definition.
--
-- Paid = a plan on sale (`is_paid`) or credits left from before paid-first (a pack, a refund, an old signup gift), the
-- same rule `lib/paid-first.ts` used. Credits are only ever bought, so a free first run never makes an account "paid".
--
-- SQLSTATE P0402 is ours alone: `lib/api/errors.ts` maps it to HTTP 402 with the code `plan_required`, and the web
-- answers it with the plan sheet. A founder can only ask about themselves; the service role (no `auth.uid()`) can ask
-- about anyone.

create or replace function public.cmo_require_paid(p_user uuid) returns void
  language plpgsql stable security definer
  set search_path to ''
as $$
begin
  if p_user is null or (auth.uid() is not null and auth.uid() <> p_user) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if not public.is_paid(p_user) and public.credit_balance(p_user) <= 0 then
    raise exception 'Pick a plan to keep going. Your first plan and drafts stay here.' using errcode = 'P0402';
  end if;
end;
$$;

revoke all on function public.cmo_require_paid(uuid) from public, anon;
grant execute on function public.cmo_require_paid(uuid) to authenticated, service_role;
