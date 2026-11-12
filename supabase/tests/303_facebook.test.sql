-- 20270120030000: Facebook is a Page the founder connects, a text platform of the posting plan and a target of the
-- fan-out. Autopilot for Facebook stays off. Without a connected Page the slot is copy and open.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

select is(public.platform_profile_id('Facebook'), 'facebook', 'the calendar label maps to the profile');
select is((public.platform_profile('facebook')->>'limit')::int, 4000, 'a Facebook post is 4,000 characters at most');
select is(public.schedule_platform_label('facebook'), 'Facebook', 'cards name it');

insert into auth.users (id, email) values
  ('e3030000-0000-4000-8000-00000000000a', 'fb-a@test.local'),
  ('e3030000-0000-4000-8000-00000000000b', 'fb-b@test.local');
update public.profiles set plan = 'starter', timezone = 'UTC'
where id in ('e3030000-0000-4000-8000-00000000000a', 'e3030000-0000-4000-8000-00000000000b');
select public.zernio_profile_save('e3030000-0000-4000-8000-00000000000a', 'prof-fb');
select lives_ok($$ select public.social_account_save('e3030000-0000-4000-8000-00000000000a', 'facebook', 'My Page', null, 'acc-fb') $$,
  'a Facebook Page connects');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3030000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.save_autopilot(array['x', 'facebook'], 12::smallint) $$, '22023', null,
  'autopilot for Facebook is refused (owner decision needed)');
select lives_ok($$ select public.save_posting_plan('{"text":{"x":1,"threads":0,"linkedin":0,"facebook":1},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  'a plan with Facebook is saved');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":1,"threads":0,"linkedin":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', 'Posts a day are set for X, Threads, LinkedIn and Facebook.', 'a plan without Facebook''s count is refused');
reset role;

select is(public.posting_plan_targets('["x","threads","linkedin","facebook"]'), '["x","threads","linkedin","facebook"]'::jsonb,
  'a slot may target all four text platforms');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e3031000-0000-4000-8000-00000000000a', 'e3030000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
   'post_draft', 'Posts', '{}', 'writer', 'done'),
  ('e3031000-0000-4000-8000-00000000000b', 'e3030000-0000-4000-8000-00000000000b', date_trunc('week', current_date)::date,
   'post_draft', 'Posts', '{}', 'writer', 'done');

create function pg_temp.slots(p_user uuid, p_order uuid, p_item uuid, p_body jsonb) returns text language plpgsql as $$
declare
  v_d uuid;
begin
  insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
  values (p_item, p_user, 'post', 'X', current_date, 'A post', 'approved', p_body);
  insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
  values (p_user, p_order, 'post', 'content_item', p_item, 'decided') returning id into v_d;
  perform public.schedule_propose(v_d);
  return (select string_agg(platform || ' ' || mode, ', ' order by platform) from public.schedule_slots where deliverable_id = v_d);
end;
$$;

select is(pg_temp.slots('e3030000-0000-4000-8000-00000000000a', 'e3031000-0000-4000-8000-00000000000a',
  'e3032000-0000-4000-8000-000000000001', '{"text":"For the Page.","targets":["x","facebook"]}'),
  'facebook publish, x intent', 'the connected Page publishes, X without an account is copy and open');
select is(pg_temp.slots('e3030000-0000-4000-8000-00000000000b', 'e3031000-0000-4000-8000-00000000000b',
  'e3032000-0000-4000-8000-000000000002', '{"text":"For my profile.","targets":["facebook"]}'),
  'facebook intent', 'a personal profile (no Page connected) gets copy and open');

-- "I posted it" on a Facebook post takes a Facebook link only.
update public.content_items set platform = 'Facebook', body = body - 'targets' where id = 'e3032000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3030000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.cmo_mark_posted('e3032000-0000-4000-8000-000000000002', 'https://evil.example/post') $$,
  '22023', 'Paste the link to your post on Facebook, like https://www.facebook.com/yourpage/posts/123.', 'another site is refused');
select lives_ok($$ select public.cmo_mark_posted('e3032000-0000-4000-8000-000000000002', 'https://www.facebook.com/mypage/posts/123') $$,
  'a Facebook link is taken');
reset role;

select * from finish();
rollback;
