-- Wave 3, for session B (A.md Requests): follow-up re-reads see Threads and the reply link the founder pasted (B6),
-- a read of who is due a nudge (B2), and a post's Library sources kept and checked on the plan and the draft (B3).

-- B6: Threads replies are re-read too, from the link the founder pasted when there is one.
create or replace function public.cmo_reply_outcomes_due(p_user uuid, p_limit integer)
returns table (outcome_id uuid, opportunity_id uuid, platform text, url text, community text, reply text, outcome_url text)
  language sql stable security definer
  set search_path to ''
as $$
  select o.id, p.id, p.platform, p.url, p.community, p.reply, coalesce(p.reply_url, o.outcome_url)
  from public.cmo_draft_outcomes o
  join public.opportunities p on p.id = o.item_id and p.user_id = o.user_id
  where o.user_id = p_user and o.department = 'sales' and o.action = 'replied' and o.outcome_checked_at is null
    and o.decided_at <= now() - interval '3 days' and p.reply is not null
    and p.platform in ('reddit', 'hn', 'threads')
  order by o.decided_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- B2: people the founder replied to more than 4 days ago, no answer seen and no nudge yet, oldest reply first.
create function public.cmo_nudges_due(p_user uuid, p_limit integer default 10)
returns table (opportunity_id uuid, url text, platform text, community text, title text, snippet text, reply text, posted_at timestamptz)
  language sql stable security definer
  set search_path to ''
as $$
  select o.id, o.url, o.platform, o.community, o.title, o.snippet, o.reply, o.posted_at
  from public.opportunities o
  where o.user_id = p_user and o.person_status = 'replied' and o.nudge_draft is null
    and o.replied_at < now() - interval '4 days'
  order by o.replied_at
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
revoke all on function public.cmo_nudges_due(uuid, integer) from public, anon, authenticated;
grant execute on function public.cmo_nudges_due(uuid, integer) to service_role;

create index opportunities_nudges_due_idx on public.opportunities (user_id, replied_at)
  where person_status = 'replied' and nudge_draft is null;

-- B3: a post's sources (PostSource, apps/web/lib/cmo/jobs/types.ts), cleaned: at most 5, each an opportunity of the
-- founder, a summary of 1 to 200 characters, a Sales platform, a community of at most 120. An invalid one is dropped,
-- never failing the plan; null when none is left.
create function public.post_sources_clean(p_user uuid, p_sources jsonb)
returns jsonb
  language sql stable
  set search_path to ''
as $$
  select nullif(coalesce(jsonb_agg(jsonb_build_object(
      'opportunityId', s->>'opportunityId', 'summary', btrim(s->>'summary'),
      'platform', s->>'platform', 'community', coalesce(s->>'community', '')) order by n), '[]'::jsonb), '[]'::jsonb)
  from (
    select s, n from jsonb_array_elements(case when jsonb_typeof(p_sources) = 'array' then p_sources else '[]'::jsonb end)
      with ordinality as x(s, n)
    where jsonb_typeof(s) = 'object'
      and coalesce(s->>'opportunityId', '') ~ '^[0-9a-fA-F-]{36}$'
      and char_length(btrim(coalesce(s->>'summary', ''))) between 1 and 200
      and s->>'platform' in ('reddit', 'hn', 'facebook', 'threads')
      and char_length(coalesce(s->>'community', '')) <= 120
      and exists (select 1 from public.opportunities o where o.id = (s->>'opportunityId')::uuid and o.user_id = p_user)
    order by n
    limit 5
  ) y;
$$;
revoke all on function public.post_sources_clean(uuid, jsonb) from public, anon, authenticated;

create or replace function public.cmo_plan_week(p_user uuid, p_run uuid, p_items jsonb)
returns integer
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_day date;
  v_targets jsonb;
  v_sources jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then
    raise exception 'This plan is not valid.' using errcode = '22023';
  end if;
  delete from public.content_items where user_id = p_user and status = 'planned' and day >= current_date;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_day := (v_item->>'day')::date;
    if v_day < current_date or v_day > current_date + 13 then
      continue;
    end if;
    v_targets := case when v_item->>'department' = 'post' then public.posting_plan_targets(v_item->'targets') end;
    v_sources := case when v_item->>'department' = 'post' then public.post_sources_clean(p_user, v_item->'sources') end;
    insert into public.content_items (user_id, run_id, department, platform, day, idea, reason, wants_image, body)
    values (
      p_user, p_run, v_item->>'department', left(v_item->>'platform', 20), v_day,
      left(v_item->>'idea', 300), left(coalesce(v_item->>'reason', ''), 300),
      coalesce(v_item->>'department' = 'post' and jsonb_typeof(v_item->'image') = 'boolean' and (v_item->>'image')::boolean, false),
      (case
        when v_targets is null then '{}'::jsonb
        when jsonb_typeof(v_item->'slot') = 'number' and (v_item->>'slot')::numeric in (0, 1, 2)
          then jsonb_build_object('targets', v_targets, 'slot', (v_item->>'slot')::int)
        else jsonb_build_object('targets', v_targets)
      end) || jsonb_strip_nulls(jsonb_build_object('sources', v_sources))
    );
    v_count := v_count + 1;
  end loop;
  -- The tree only tracks the plan: a fault in it must not lose the calendar.
  begin
    perform public.work_orders_plan_week(p_user, p_run);
  exception when others then
    raise warning 'work_orders_plan_week failed for run %: %', p_run, sqlerrm;
  end;
  return v_count;
end;
$$;

create or replace function public.cmo_save_draft(p_user uuid, p_run uuid, p_item uuid, p_idea text, p_body jsonb,
  p_priority text default 'medium', p_platform text default null)
returns public.content_items
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_row public.content_items;
  v_profile jsonb := public.platform_profile(public.platform_profile_id(p_platform));
  v_post boolean := coalesce(v_profile->>'kind' = 'post', false);
  v_platform text := case when v_post then v_profile->>'label' else 'x' end;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' or coalesce(p_body->>'text', '') = '' then
    raise exception 'This draft is not valid.' using errcode = '22023';
  end if;
  if p_body ? 'thread' then
    if not public.thread_valid(p_body) then
      raise exception 'A thread has 5 to 8 posts of at most 280 characters, the first being the post.' using errcode = '22023';
    end if;
    if coalesce(public.platform_profile_id(case when p_item is not null
         then (select platform from public.content_items where id = p_item and user_id = p_user) else v_platform end), 'x') <> 'x' then
      raise exception 'Only an X post can be a thread.' using errcode = '22023';
    end if;
  end if;
  if p_item is not null then
    -- The draft's own sources win; a draft that sends none keeps the ones the plan gave its item.
    update public.content_items
    set status = 'in_review',
        body = (p_body - 'targets' - 'slot' - 'sources')
          || jsonb_strip_nulls(jsonb_build_object('targets', body->'targets', 'slot', body->'slot',
               'sources', coalesce(public.post_sources_clean(p_user, p_body->'sources'), public.post_sources_clean(p_user, body->'sources')))),
        priority = coalesce(p_priority, 'medium'), run_id = p_run, updated_at = now()
    where id = p_item and user_id = p_user and status in ('planned', 'drafting')
    returning * into v_row;
    if not found then
      raise exception 'This calendar item is no longer open.' using errcode = 'P0002';
    end if;
  else
    insert into public.content_items (user_id, run_id, department, platform, day, idea, status, priority, body)
    values (p_user, p_run, 'post', v_platform, current_date,
            left(coalesce(nullif(p_idea, ''), 'Post for ' || case when v_post then v_profile->>'label' else 'X' end), 300),
            'in_review', coalesce(p_priority, 'medium'),
            (p_body - 'targets' - 'slot' - 'sources')
              || jsonb_strip_nulls(jsonb_build_object('sources', public.post_sources_clean(p_user, p_body->'sources'))))
    returning * into v_row;
  end if;
  return v_row;
end;
$$;
