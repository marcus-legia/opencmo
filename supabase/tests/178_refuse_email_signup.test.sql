-- refuse_email_signup (20261210103000): the before_user_created hook refuses email signups and
-- lets Google through; only Auth can call it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

select is(
  public.refuse_email_signup('{"user":{"email":"a@test.local","app_metadata":{"provider":"email","providers":["email"]}}}') #>> '{error,http_code}',
  '403', 'an email signup is refused');
select is(
  public.refuse_email_signup('{"user":{"email":"a@test.local","app_metadata":{"provider":"email"}}}') #>> '{error,message}',
  'New accounts sign up with Google.', 'with an English reason');
select is(public.refuse_email_signup('{"user":{"app_metadata":{"provider":"google","providers":["google"]}}}'), '{}'::jsonb, 'Google passes');
select ok(not has_function_privilege('authenticated', 'public.refuse_email_signup(jsonb)', 'execute'), 'users cannot call the hook');
select ok(has_function_privilege('supabase_auth_admin', 'public.refuse_email_signup(jsonb)', 'execute'), 'Auth can');

select * from finish();
rollback;
