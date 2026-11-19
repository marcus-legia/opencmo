-- Wave 3 review (PR #239): the reply link the founder pastes, and a DM or email that is not a public reply.
--
-- 1. "I replied" took only a Reddit link that repeated the thread's path with its title slug, case for case, and a
--    Threads link with no query, on threads.com. The links people copy are a comment link (`/comments/<id>/comment/
--    <cid>/`, no slug), a phone share link (`/r/<sub>/s/<code>`), and a Threads link with `?xmt=…` or on threads.net.
--    The link is now cleaned first (query, fragment and trailing slash off; Threads on www.threads.com, the host its
--    reader reads), and Reddit matches on the subreddit and the post id, case-insensitive. A share link carries no
--    post id, so it is held to the thread's subreddit.
-- 2. "I sent it" on a DM or an email marked the person replied as if a public reply were up, so a nudge was drafted
--    "under their comment" and the reply re-read looked for a reply that was never posted. Such a person is now
--    `contacted_via` 'dm' or 'email', and both reads leave them out.
-- 3. A post planned from the founder's brief or in the first week has no Library sources by design, but its draft was
--    refused for an empty Library. The plan now marks it (`body.planned_from`) and the draft writes it.

-- What `opportunity_mark_replied` stores: the pasted Reddit or Threads link without its query, fragment or trailing
-- slash, a Threads link on www.threads.com; HN and Facebook links as pasted.
create function public.reply_url_clean(p_platform text, p_url text)
returns text
  language sql immutable
  set search_path to ''
as $$
  select case
    -- HN's only form is `?id=`; a Facebook comment link names the comment in its query (`?comment_id=`).
    when p_platform in ('hn', 'facebook') then btrim(coalesce(p_url, ''))
    when p_platform = 'threads' then regexp_replace(
      rtrim(regexp_replace(btrim(coalesce(p_url, '')), '[?#].*$', ''), '/'),
      '^https://(www\.)?threads\.(com|net)/', 'https://www.threads.com/', 'i')
    else rtrim(regexp_replace(btrim(coalesce(p_url, '')), '[?#].*$', ''), '/')
  end;
$$;
revoke all on function public.reply_url_clean(text, text) from public, anon, authenticated;

create or replace function public.reply_url_fits(p_platform text, p_thread text, p_url text)
returns boolean
  language sql immutable
  set search_path to ''
as $$
  select char_length(p_url) <= 500 and p_url !~ '\s' and case p_platform
    when 'reddit' then p_url ~* '^https://(www\.|old\.|new\.|m\.)?reddit\.com/r/'
      and (
        -- A comment or post link: the same subreddit and post id as the thread.
        coalesce(lower(substring(p_url from '(?i)/r/[^/]+/comments/[a-z0-9]+'))
          = lower(substring(p_thread from '(?i)/r/[^/]+/comments/[a-z0-9]+')), false)
        -- A phone share link names no post: it must at least be in the thread's subreddit.
        or (p_url ~* '^https://(www\.)?reddit\.com/r/[^/]+/s/[A-Za-z0-9]+$'
            and coalesce(lower(substring(p_url from '(?i)/r/[^/]+/')) = lower(substring(p_thread from '(?i)/r/[^/]+/')), false))
      )
    when 'hn' then p_url ~ '^https://news\.ycombinator\.com/item\?id=[0-9]{1,12}$'
    when 'facebook' then p_url ~ '^https://www\.facebook\.com/groups/'
      and split_part(regexp_replace(p_url, '^https://www\.facebook\.com/groups/', ''), '/', 1)
        = split_part(regexp_replace(p_thread, '^https://www\.facebook\.com/groups/', ''), '/', 1)
    when 'threads' then p_url ~ '^https://www\.threads\.com/@[A-Za-z0-9._]{1,30}/post/[A-Za-z0-9_-]{1,40}$'
    else false
  end;
$$;

create or replace function public.opportunity_mark_replied(p_id uuid, p_url text)
returns public.opportunities
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_opp public.opportunities;
  v_url text;
begin
  select * into v_opp from public.opportunities o where o.id = p_id and o.user_id = v_user;
  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  if v_opp.status = 'dismissed' then
    raise exception 'You dismissed this conversation.' using errcode = 'P0001';
  end if;
  v_url := public.reply_url_clean(v_opp.platform, p_url);
  if not public.reply_url_fits(v_opp.platform, v_opp.url, v_url) then
    raise exception 'Paste the link to your reply in this thread.' using errcode = '22023';
  end if;
  if v_opp.status = 'in_review' then
    perform public.cmo_decide_opportunity(p_id, 'replied');
  end if;
  -- A public reply after a DM: the person is now followed as a public reply too.
  update public.opportunities o set
    reply_url = v_url,
    contacted_via = null,
    replied_at = coalesce(o.replied_at, now()),
    person_status = case when o.person_status = 'found' then 'replied' else o.person_status end,
    status_at = case when o.person_status = 'found' then now() else o.status_at end
  where o.id = p_id
  returning * into v_opp;
  update public.cmo_draft_outcomes d set outcome_url = v_url
  where d.user_id = v_user and d.department = 'sales' and d.item_id = p_id and d.action = 'replied';
  return v_opp;
end;
$$;

alter table public.opportunities add column contacted_via text
  constraint opportunities_contacted_via_check check (contacted_via in ('dm', 'email'));

-- "I sent it" on the DM or Email tab: the founder sent a private message, not a public reply. The person moves to
-- Following up (replied) as with a reply, and the card leaves review the same way, but nothing re-reads the thread for
-- it or drafts a public nudge.
create function public.opportunity_mark_sent(p_id uuid, p_via text)
returns public.opportunities
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_opp public.opportunities;
begin
  if p_via is null or p_via not in ('dm', 'email') then
    raise exception 'Say whether you sent a DM or an email.' using errcode = '22023';
  end if;
  select * into v_opp from public.opportunities o where o.id = p_id and o.user_id = v_user;
  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  if v_opp.status = 'dismissed' then
    raise exception 'You dismissed this conversation.' using errcode = 'P0001';
  end if;
  if v_opp.status = 'in_review' then
    perform public.cmo_decide_opportunity(p_id, 'replied');
  end if;
  update public.opportunities o set
    -- A public reply already linked stays the way the person is followed.
    contacted_via = case when o.reply_url is null then p_via else o.contacted_via end,
    replied_at = coalesce(o.replied_at, now()),
    person_status = case when o.person_status = 'found' then 'replied' else o.person_status end,
    status_at = case when o.person_status = 'found' then now() else o.status_at end
  where o.id = p_id
  returning * into v_opp;
  return v_opp;
end;
$$;
revoke all on function public.opportunity_mark_sent(uuid, text) from public, anon;
grant execute on function public.opportunity_mark_sent(uuid, text) to authenticated;

create or replace function public.cmo_reply_outcomes_due(p_user uuid, p_limit integer)
returns table (outcome_id uuid, opportunity_id uuid, platform text, url text, community text, reply text, outcome_url text)
  language sql stable security definer
  set search_path to ''
as $$
  select o.id, p.id, p.platform, p.url, p.community, p.reply, coalesce(p.reply_url, o.outcome_url)
  from public.cmo_draft_outcomes o
  join public.opportunities p on p.id = o.item_id and p.user_id = o.user_id
  where o.user_id = p_user and o.department = 'sales' and o.action = 'replied' and o.outcome_checked_at is null
    and o.decided_at <= now() - interval '3 days' and p.reply is not null and p.contacted_via is null
    and p.platform in ('reddit', 'hn', 'threads')
  order by o.decided_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

create or replace function public.cmo_nudges_due(p_user uuid, p_limit integer default 10)
returns table (opportunity_id uuid, url text, platform text, community text, title text, snippet text, reply text, posted_at timestamptz)
  language sql stable security definer
  set search_path to ''
as $$
  select o.id, o.url, o.platform, o.community, o.title, o.snippet, o.reply, o.posted_at
  from public.opportunities o
  where o.user_id = p_user and o.person_status = 'replied' and o.nudge_draft is null and o.contacted_via is null
    and o.replied_at < now() - interval '4 days'
  order by o.replied_at
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

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
      end) || jsonb_strip_nulls(jsonb_build_object(
        'sources', v_sources,
        -- A post planned with no Library sources from the founder's brief or the first week (onboarding): the draft
        -- writes it without sources instead of refusing it for an empty Library.
        'planned_from', case when v_item->>'department' = 'post' and v_sources is null
                               and v_item->>'planned_from' in ('brief', 'onboarding') then v_item->>'planned_from' end))
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
