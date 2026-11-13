-- 20270121030000: a core post is published once its last slot is over, including a last slot that failed for good.
-- The settle runs at commit; `set constraints all immediate` fires it inside this test's transaction. The race between
-- two slots is tested with two real connections in packages/engine/tests/test_web_sql_concurrency.py.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

select ok(not has_function_privilege('authenticated', 'public.post_settle(uuid)', 'execute'), 'a founder cannot run the settle');

insert into auth.users (id, email) values ('e3110000-0000-4000-8000-00000000000a', 'settle@test.local');
update public.profiles set plan = 'starter', credit_balance = 20, timezone = 'UTC' where id = 'e3110000-0000-4000-8000-00000000000a';
select public.zernio_profile_save('e3110000-0000-4000-8000-00000000000a', 'prof-settle');
select public.social_account_save('e3110000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-settle-x');
select public.social_account_save('e3110000-0000-4000-8000-00000000000a', 'linkedin', 'Founder', null, 'acc-settle-li');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3111000-0000-4000-8000-00000000000a', 'e3110000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'done');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e3112000-0000-4000-8000-000000000001', 'e3110000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Core', 'approved',
  '{"text":"One core post.","targets":["x","linkedin"]}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
values ('e3113000-0000-4000-8000-000000000001', 'e3110000-0000-4000-8000-00000000000a', 'e3111000-0000-4000-8000-00000000000a', 'post',
  'content_item', 'e3112000-0000-4000-8000-000000000001', 'decided');
create function pg_temp.slot(p_platform text) returns uuid language sql as $$
  select id from public.schedule_slots where deliverable_id = 'e3113000-0000-4000-8000-000000000001' and platform = p_platform;
$$;
create function pg_temp.item_status() returns text language sql as $$
  select status from public.content_items where id = 'e3112000-0000-4000-8000-000000000001';
$$;

update public.schedule_slots set status = 'publishing' where deliverable_id = 'e3113000-0000-4000-8000-000000000001';
select public.publish_status(pg_temp.slot('x'), 'published', 'ext-x-311', 'https://x.com/founder/status/311');
select public.publish_status(pg_temp.slot('linkedin'), 'failed', null, null, '{"code":"rejected","message":"LinkedIn refused it."}');
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.item_status(), 'approved', 'a failed slot whose Retry card waits is not over');

update public.approvals set status = 'expired' where ref_kind = 'schedule_slot' and ref_id = pg_temp.slot('linkedin') and status = 'waiting';
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.item_status(), 'published', 'once its card is gone, the post that went out on X is published');
select is((select external_url from public.content_items where id = 'e3112000-0000-4000-8000-000000000001'),
  'https://x.com/founder/status/311', 'with the link of the platform it went out on');

-- Nothing went out anywhere: the post is not published.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e3112000-0000-4000-8000-000000000002', 'e3110000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 1, 'Core two', 'approved',
  '{"text":"Another core post.","targets":["x","linkedin"]}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
values ('e3113000-0000-4000-8000-000000000002', 'e3110000-0000-4000-8000-00000000000a', 'e3111000-0000-4000-8000-00000000000a', 'post',
  'content_item', 'e3112000-0000-4000-8000-000000000002', 'decided');
update public.schedule_slots set status = 'cancelled' where deliverable_id = 'e3113000-0000-4000-8000-000000000002';
set constraints all immediate;
set constraints all deferred;
select is((select status from public.content_items where id = 'e3112000-0000-4000-8000-000000000002'), 'approved',
  'a post that went out nowhere is not published');

-- A slot is over only when it is terminal: a proposed one keeps the post open.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e3112000-0000-4000-8000-000000000003', 'e3110000-0000-4000-8000-00000000000a', 'post', 'X', current_date + 2, 'Core three', 'approved',
  '{"text":"A third core post.","targets":["x","linkedin"]}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
values ('e3113000-0000-4000-8000-000000000003', 'e3110000-0000-4000-8000-00000000000a', 'e3111000-0000-4000-8000-00000000000a', 'post',
  'content_item', 'e3112000-0000-4000-8000-000000000003', 'decided');
update public.schedule_slots set status = 'publishing' where deliverable_id = 'e3113000-0000-4000-8000-000000000003' and platform = 'x';
select public.publish_status((select id from public.schedule_slots where deliverable_id = 'e3113000-0000-4000-8000-000000000003' and platform = 'x'),
  'published', 'ext-x-311c', 'https://x.com/founder/status/3113');
set constraints all immediate;
set constraints all deferred;
select is((select status from public.content_items where id = 'e3112000-0000-4000-8000-000000000003'), 'approved',
  'X posted, LinkedIn still waits: not published yet');
select ok((select status in ('proposed', 'waiting') from public.schedule_slots
  where deliverable_id = 'e3113000-0000-4000-8000-000000000003' and platform = 'linkedin'), 'and the LinkedIn slot is untouched');

select * from finish();
rollback;
