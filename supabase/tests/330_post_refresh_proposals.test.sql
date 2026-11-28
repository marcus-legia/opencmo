-- 20270208010000: a post card waiting past its proposed time gets the next free one, raised as a new card; a card
-- whose time is still ahead keeps it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(8);

select ok(not has_function_privilege('authenticated', 'public.post_refresh_proposals(integer)', 'execute'), 'a founder cannot call it');
select ok(not has_function_privilege('anon', 'public.post_refresh_proposals(integer)', 'execute'), 'anon cannot');

insert into auth.users (id, email) values ('e3300000-0000-4000-8000-00000000000a', 'refresh-a@test.local');
update public.profiles set plan = 'starter', timezone = 'Asia/Saigon' where id = 'e3300000-0000-4000-8000-00000000000a';
select public.zernio_profile_save('e3300000-0000-4000-8000-00000000000a', 'prof-refresh');
select public.social_account_save('e3300000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-refresh-x');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3301000-0000-4000-8000-00000000000a', 'e3300000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'done');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3302000-0000-4000-8000-00000000000a', 'e3300000-0000-4000-8000-00000000000a', 'post', 'X', current_date - 1, 'Stale', 'in_review',
   '{"text":"Waited overnight."}'),
  ('e3302000-0000-4000-8000-00000000000b', 'e3300000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Fresh', 'in_review',
   '{"text":"Still ahead."}');
insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
select 'e3300000-0000-4000-8000-00000000000a', 'e3301000-0000-4000-8000-00000000000a', 'post', 'content_item', id, 'waiting_founder'
from public.content_items where user_id = 'e3300000-0000-4000-8000-00000000000a';

-- The first card's time passes while it waits.
update public.content_items set body = jsonb_set(body, '{proposed,at}', '"2020-01-01T02:00:00Z"')
where id = 'e3302000-0000-4000-8000-00000000000a';
create temp table t_before on commit drop as
select c.idea as name, a.id, c.body->'proposed'->>'at' as at
from public.approvals a join public.content_items c on c.id = a.ref_id
where a.ref_kind = 'content_item' and a.status = 'waiting' and c.user_id = 'e3300000-0000-4000-8000-00000000000a';

select is((select at from t_before where name = 'Stale'), '2020-01-01T02:00:00Z', 'the stale card shows a time that has passed');
select ok(public.post_refresh_proposals() >= 1, 'the post whose time passed is refreshed');
select ok((select public.post_proposed_at(body) > now() from public.content_items where id = 'e3302000-0000-4000-8000-00000000000a'),
  'it proposes a time ahead');
select isnt((select status from public.approvals where id = (select id from t_before where name = 'Stale')), 'waiting',
  'the old card no longer waits');
select is((select a.snapshot->'proposed'->>'at' from public.approvals a
  where a.ref_id = 'e3302000-0000-4000-8000-00000000000a' and a.status = 'waiting'),
  (select body->'proposed'->>'at' from public.content_items where id = 'e3302000-0000-4000-8000-00000000000a'),
  'the new card shows the new time');
select is((select body->'proposed'->>'at' from public.content_items where id = 'e3302000-0000-4000-8000-00000000000b'),
  (select at from t_before where name = 'Fresh'), 'a time still ahead is kept');

select * from finish();
rollback;
