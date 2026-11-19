-- Review of #238, finding 3: the autopilot push read waiting post cards with an `auto_at` soon and checked only the
-- top-bar pause, so it said "goes out at 14:00" for posts autopilot would not publish (the CMO paused, the plan gone,
-- the account disconnected, the platform no longer on autopilot, a chat brief). The cards come from SQL now, through
-- the same rule `autopilot_approve_due` applies, with the platform autopilot posts to.
create function public.autopilot_push_due(p_now timestamptz, p_until timestamptz)
returns table (id uuid, user_id uuid, platform text, auto_at timestamptz)
  language sql stable security definer
  set search_path to ''
as $$
  select a.id, a.user_id, a.snapshot->'proposed'->>'platform', a.auto_at
  from public.approvals a
  where a.status = 'waiting' and a.kind = 'post'
    and a.auto_at > p_now and a.auto_at <= p_until
    and public.post_autopilot_still_on(a)
  order by a.auto_at
  limit 200;
$$;

revoke all on function public.autopilot_push_due(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.autopilot_push_due(timestamptz, timestamptz) to service_role;

-- Finding 4: a push carries no payload, so the service worker asks what to show. It now shows every autopilot post
-- about to go out (each under its own tag) plus the waiting count, instead of the first post only, which hid a second
-- post and every new-card push. The founder's own list, by the same rule.
create function public.my_autopilot_due()
returns table (id uuid, platform text, auto_at timestamptz)
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
begin
  return query
    select d.id, d.platform, d.auto_at
    from public.autopilot_push_due(now(), now() + interval '2 hours') d
    where d.user_id = v_user
    limit 5;
end;
$$;

revoke all on function public.my_autopilot_due() from public, anon;
grant execute on function public.my_autopilot_due() to authenticated, service_role;
