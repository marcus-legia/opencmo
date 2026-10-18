-- Email signup off (security fixes plan, fix 4). The product signs in with Google only; an open
-- `/auth/v1/signup` is a free path to mass accounts.
--
-- Not `[auth.email] enable_signup = false`: the CLI maps that to "email provider off", which also
-- stops password sign-in, and the e2e suite and `check:api` sign in admin-made users with a
-- password. This Auth hook (`before_user_created`) refuses only new users whose provider is
-- `email`; Google signups pass, and `auth.admin.createUser` does not run the hook at all.
-- Production: owner task O1 turns the Email provider off, and may point the same hook here.

create or replace function public.refuse_email_signup(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when event #>> '{user,app_metadata,provider}' = 'email'
      then jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'New accounts sign up with Google.'))
    else '{}'::jsonb
  end;
$$;

revoke all on function public.refuse_email_signup(jsonb) from public, anon, authenticated;
grant execute on function public.refuse_email_signup(jsonb) to supabase_auth_admin;
