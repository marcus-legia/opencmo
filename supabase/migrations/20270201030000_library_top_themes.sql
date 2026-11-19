-- Wave 3 A2 follow-up, for B3 (posts from the Library): `plan_week` and `post_draft` run under the service role, so
-- they read the founder's top themes here instead of through `my_library`. A theme counts the entries whose thread was
-- posted (or, with no date, saved) in the last `p_days`; most entries first, each with its five newest entries.
create function public.cmo_library_top_themes(p_user uuid, p_days integer default 14, p_limit integer default 5)
returns jsonb
  language sql stable security definer
  set search_path to ''
as $$
  with e as (
    select le.* from public.library_entries le
    where le.user_id = p_user and le.theme_id is not null
      and coalesce(le.posted_at, le.created_at) > now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
  ), t as (
    select th.id, th.name, count(*)::integer as n
    from public.library_themes th join e on e.theme_id = th.id
    where th.user_id = p_user
    group by th.id, th.name
    order by n desc, th.name
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'count', t.n, 'entries', (
    select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) from (
      select jsonb_build_object('opportunityId', e.opportunity_id, 'summary', e.summary, 'platform', e.platform,
        'community', e.community, 'postedAt', e.posted_at, 'quotes', e.quotes) j,
        coalesce(e.posted_at, e.created_at) at
      from e where e.theme_id = t.id
      order by coalesce(e.posted_at, e.created_at) desc limit 5
    ) x)) order by t.n desc, t.name), '[]'::jsonb)
  from t;
$$;

revoke all on function public.cmo_library_top_themes(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.cmo_library_top_themes(uuid, integer, integer) to service_role;
