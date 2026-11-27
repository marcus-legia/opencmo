-- Connecting a platform schedules the posts the founder already approved for it.
--
-- From 20270206040000 `schedule_propose` gives a post no slot on a platform with no connected account. The post card
-- still lets the founder approve such a post (and copy it, or say "I posted it"), and approving it was the only moment
-- anything asked for its time. So a post approved before its platform was connected stayed `approved` with no slot
-- forever: the Post page called it Scheduled and it never went out.
--
-- `social_account_save` is the one write behind a connect (the OAuth callback and the sync), so it now proposes a time
-- for every approved post of today or later that targets the platform just connected. `schedule_propose` skips any
-- platform that already has a slot, so a save that only refreshes a handle adds nothing. Scheduling never fails the
-- connect: the account is saved either way.

create or replace function public.social_account_save(p_user uuid, p_platform text, p_handle text, p_avatar_url text, p_zernio_account_id text)
  returns public.social_accounts
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_row public.social_accounts;
  v_d uuid;
begin
  if not exists (select 1 from public.zernio_profiles where user_id = p_user) then
    raise exception 'Connect starts with a Zernio profile.' using errcode = 'P0001';
  end if;
  if not public.cmo_paid(p_user) and not exists (
    select 1 from public.social_accounts
    where user_id = p_user and platform = p_platform and zernio_account_id = p_zernio_account_id and status = 'connected'
  ) then
    perform public.cmo_plan_required();
  end if;
  insert into public.social_accounts (user_id, platform, handle, avatar_url, zernio_account_id)
  values (p_user, p_platform, left(trim(p_handle), 100), nullif(trim(coalesce(p_avatar_url, '')), ''), p_zernio_account_id)
  on conflict (user_id, platform) do update
    set handle = excluded.handle, avatar_url = excluded.avatar_url, zernio_account_id = excluded.zernio_account_id,
        status = 'connected', connected_at = case when social_accounts.zernio_account_id = excluded.zernio_account_id
          then social_accounts.connected_at else now() end,
        updated_at = now()
  returning * into v_row;
  if v_row.status = 'connected' then
    for v_d in
      select d.id from public.deliverables d
      join public.content_items c on c.id = d.ref_id and c.user_id = p_user
      where d.user_id = p_user and d.kind = 'post' and d.ref_kind = 'content_item' and d.status = 'decided'
        and c.department = 'post' and c.status = 'approved' and c.day >= current_date
        and p_platform = any(public.post_targets(c.id))
    loop
      begin
        perform public.schedule_propose(v_d);
      exception when others then
        raise warning 'schedule after connect failed for deliverable %: %', v_d, sqlerrm;
      end;
    end loop;
  end if;
  return v_row;
end;
$$;
revoke all on function public.social_account_save(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.social_account_save(uuid, text, text, text, text) to service_role;
