-- Paid plan check (security fixes plan, fix 5: docs/plans/security/2026-10-17-mcp-auth-api-fixes-plan.md).
--
-- One definition of "paid" for every gate that keeps paid features paid: MCP admission, API keys,
-- OAuth consent and the free `brain = 'claude'` CMO run. `process_polar_event` writes
-- `profiles.plan`; there is no constraint on it, so anything but the two plan ids is unpaid.
--
-- A signed-in caller may only learn their own status: another user's id answers false rather than
-- leaking who pays. Service role and other definer functions (no `auth.uid()`) get the real answer.

create or replace function public.is_paid(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.plan in ('starter', 'creator')
       from public.profiles p
      where p.id = p_user
        and (auth.uid() is null or auth.uid() = p_user)),
    false);
$$;

revoke all on function public.is_paid(uuid) from public, anon;
grant execute on function public.is_paid(uuid) to authenticated, service_role;
