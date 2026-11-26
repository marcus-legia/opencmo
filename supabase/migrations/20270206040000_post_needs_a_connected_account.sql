-- A post is scheduled only for a platform with a connected account (owner, 2026-11-26).
--
-- `schedule_propose` gave a post a slot on every platform of `post_targets`, and when no account was connected the
-- slot was `intent`: the founder was meant to copy the words and post them by hand. In practice that slot could only
-- settle `failed` with `no_account`, the calendar showed it red, and the failure asked for a new time. One platform
-- chosen at onboarding and never connected was enough to fill a week with copies of a post that was never going to
-- go out.
--
-- The app stops writing for an unconnected platform (`lib/cmo/posting-plan.ts` `connectedOnly`). This is the second
-- layer, for a post written before the account went away: an item already written, or an account disconnected
-- between the writing and the scheduling.
--
-- Posts only. A photo post and a video keep their own platforms and their own rules; `intent` stays for them.

create or replace function public.schedule_propose(p_deliverable uuid) returns integer
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_d public.deliverables;
  v_rules jsonb := public.schedule_rules();
  v_platform text;
  v_platforms text[];
  v_at timestamptz;
  v_account uuid;
  v_slot uuid;
  v_n integer := 0;
  v_taken text;
begin
  select * into v_d from public.deliverables where id = p_deliverable;
  if not found then
    return 0;
  end if;
  if v_d.kind = 'post' and v_d.ref_kind = 'content_item' then
    -- Every platform of the post's slot (Writer's old items: the one platform of their label). A post one platform
    -- already published (F1) still asks for a new time on the others; one posted by hand on its card does not.
    select array(select t from unnest(public.post_targets(c.id)) with ordinality as u(t, o)
                 where t in ('x', 'threads', 'linkedin', 'facebook') order by o)
      into v_platforms
    from public.content_items c where c.id = v_d.ref_id
      and public.post_schedules(c.status, v_d.id);
  elsif v_d.kind = 'photo_post' and v_d.ref_kind = 'photo_post' then
    -- The founder's own photos (D7): every platform they picked, each from its connected account.
    select array(select p from unnest(platforms) p where p in ('tiktok', 'instagram', 'threads') order by p) into v_platforms
    from public.photo_posts where id = v_d.ref_id and user_id = v_d.user_id and status = 'scheduled';
  elsif v_d.kind in ('short', 'slideshow', 'video') and v_d.ref_kind = 'clip' then
    select array_agg(p) into v_platforms from unnest(array['tiktok', 'instagram', 'youtube']) p
    where exists (select 1 from public.content_items c
      where c.clip_id = v_d.ref_id and c.department = 'video' and c.status in ('in_review', 'approved')
        and c.platform = public.platform_profile_id(p));
  end if;
  foreach v_platform in array coalesce(v_platforms, '{}') loop
    continue when exists (select 1 from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform
      and status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published'));
    -- A failure waits on its Retry card: while that card is undecided (`waiting`, or `held` by the card budget) the
    -- founder owns it, so no twin is made. One still inside its window, or that may have gone out (`unconfirmed`),
    -- gets none either.
    continue when exists (select 1 from public.schedule_slots s where s.deliverable_id = v_d.id and s.platform = v_platform
      and s.status = 'failed' and (s.window_ends_at > now() or s.error->>'code' = 'unconfirmed'
        or exists (select 1 from public.approvals a
          where a.ref_kind = 'schedule_slot' and a.ref_id = s.id and a.status in ('waiting', 'held'))));
    continue when (select count(*) from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform)
      >= (v_rules->>'maxProposals')::integer;
    v_account := null;
    select id into v_account from public.social_accounts
    where user_id = v_d.user_id and platform = v_platform and status = 'connected';
    -- A post with no account to post to is not scheduled at all: it could only fail at its time and ask again.
    continue when v_d.kind = 'post' and v_account is null;
    -- The post card carried its time (cmo-review-3 1.2) for its first platform: approving the post approved it, so no
    -- schedule card asks. The other targets get a card each.
    v_taken := 'none';
    if v_d.kind = 'post' then
      v_taken := public.schedule_take_proposal(v_d, v_platform);
      if v_taken = 'taken' then
        v_n := v_n + 1;
        continue;
      end if;
    end if;
    v_at := public.schedule_pick_time(v_d.user_id, v_platform, v_d.id);
    continue when v_at is null;
    -- TikTok's posting guidelines: the founder picks the audience and turns on each interaction and disclosure;
    -- nothing starts on.
    insert into public.schedule_slots (user_id, deliverable_id, platform, account_id, mode, publish_at, jitter_seconds,
      window_ends_at, options)
    values (v_d.user_id, v_d.id, v_platform, v_account, case when v_account is null then 'intent' else 'publish' end,
      v_at, public.schedule_jitter(), v_at + make_interval(mins => (v_rules->>'windowMinutes')::integer),
      case when v_platform = 'tiktok' then '{"allow_comment": false, "allow_duet": false, "allow_stitch": false,
        "brand_organic": false, "brand_content": false}'::jsonb else '{}'::jsonb end
      || case when v_platform = 'x' and exists (select 1 from public.schedule_slots o
                where o.deliverable_id = v_d.id and o.platform = 'x' and o.options->>'as_thread' = 'true')
           then '{"as_thread": true}'::jsonb else '{}'::jsonb end)
    returning id into v_slot;
    -- The time the founder approved cannot be used: the card says why, as a missed post's card does.
    if v_taken not in ('none', 'taken') then
      update public.schedule_slots set error = jsonb_build_object('code', 'missed', 'message', v_taken) where id = v_slot;
    end if;
    perform public.approval_raise(v_d.user_id, 'schedule_slot', v_slot);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.schedule_propose(uuid) from public, anon, authenticated;
