-- A failed slot keeps its place while its Retry card waits on the founder.
--
-- `schedule_propose` refused a twin only while the failed slot was still inside its window. `windowMinutes` is 15, so
-- fifteen minutes after a failure the slot stopped blocking and the next call (the `content_items` trigger fires on
-- every status, body or platform update, and the writer touches `body` all day) silently made a second slot for the
-- same post and platform, up to `maxProposals`. The founder then saw the same post two or three times on the
-- calendar: the failure, plus the twins nobody asked for.
--
-- It also raced the Retry path: `approval_decide` on a failed slot past its window closes the card and calls
-- `schedule_propose` itself, which is how a new time is meant to be asked for. The auto-proposal got there first.
--
-- A deterministic failure made it worse. `no_account` (no connected account) and `too_long` (X refused the length)
-- fail again on exactly the same words, so each twin was a copy that could only fail the same way. On X, whose only
-- default time is 09:00, the twin landed on the NEXT day and collided with that day's own post.
--
-- The fix: while the slot's Retry card is still waiting, the founder owns the decision and no twin is made. Once they
-- decide, the card closes and the existing path proposes the new time.

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
    v_account := null;
    select id into v_account from public.social_accounts
    where user_id = v_d.user_id and platform = v_platform and status = 'connected';
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
