-- Connecting a posting account needs a plan (owner 2026-11-26). Zernio bills per connected account per day, whether
-- anything posts or not, and its two free accounts are Ferreto's, not each founder's: a free account that connects
-- X, Threads and LinkedIn costs money every day for no revenue. Posts are written only for connected platforms
-- (20270206040000), so a free account loses nothing it could use: it cannot approve or send a post anyway
-- (`paywall_on_send`).
--
-- The check sits on `social_account_save`, the one write behind both the OAuth callback and the sync that picks up a
-- connect whose callback never landed, so neither path can store an account for a free founder. The connect route
-- asks first (`requirePaid`) so the founder sees the plan sheet before Zernio's page, not after.
--
-- Saving an account that is already connected with the same Zernio id stays allowed: that only refreshes its handle
-- and avatar, adds no account at Zernio, and must not fail for a founder whose plan lapsed while it was connected.
-- The refusal is `cmo_plan_required` (P0402 → HTTP 402 `plan_required`).

create or replace function public.social_account_save(p_user uuid, p_platform text, p_handle text, p_avatar_url text, p_zernio_account_id text)
  returns public.social_accounts
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_row public.social_accounts;
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
  return v_row;
end;
$$;
