-- Code review of cmo-review-2 (20270111210000). R1: a shorts order's hold is its allowance, so usage it covered is not
-- "Over budget … of 0 credits"; the week still counts it. R2: "I posted it" refuses only a valid thread, the same rule
-- as the card; an invalid thread is posted as its text.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

insert into auth.users (id, email) values ('e2710000-0000-4000-8000-00000000000a', 'rf-a@test.local');
update public.profiles set timezone = 'UTC' where id = 'e2710000-0000-4000-8000-00000000000a';
insert into public.credit_ledger (user_id, delta, reason) values ('e2710000-0000-4000-8000-00000000000a', 500, 'test grant');

-- ================================================================ R1
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;
insert into t select 'root', id from public.work_order_create('e2710000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  null, 'plan_week', 'Week', '{}', 1000);
-- As `cut_shorts_order_for` makes it: a budget of 0.
insert into t select 'shorts', id from public.work_order_create('e2710000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from t where name = 'root'), 'cut_shorts', 'Shorts', '{}', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2710000-0000-4000-8000-00000000000a","role":"authenticated","opencmo_actor":"brain"}';
select public.studio_order_hold((select id from t where name = 'shorts'));
select public.studio_record_usage((select id from t where name = 'shorts'), 'shorts-model', 10000, 2000, 0, 0);
reset role;
create temporary table used as
  select public.agent_credits((select sum(micro_usd)::bigint from public.work_order_usage where order_id = (select id from t where name = 'shorts'))) as credits;

select is((select budget_credits from public.work_orders where id = (select id from t where name = 'shorts')), public.studio_plan_hold(),
  'the hold becomes the order''s budget');
update public.work_orders set status = 'done' where id = (select id from t where name = 'shorts');
select ok((select spent_credits from public.work_orders where id = (select id from t where name = 'shorts')) between 1 and public.studio_plan_hold(),
  'done: the order counts what its hold paid for');
select is((select count(*)::int from public.work_order_events where order_id = (select id from t where name = 'shorts') and text like 'Over budget%'), 0,
  'and is not over budget');
select is((select spent_credits from public.work_orders where id = (select id from t where name = 'root')), (select credits from used),
  'the week still counts it');

-- ================================================================ R2
insert into t select 'posts', id from public.work_order_create('e2710000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  (select id from t where name = 'root'), 'post_draft', 'Posts', '{}', 0);
update public.work_orders set status = 'done' where id = (select id from t where name = 'posts');
-- Nine items: not a thread the card shows, so the card offers "I posted it" for its text. And a valid thread.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2712000-0000-4000-8000-00000000000a', 'e2710000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Long', 'in_review',
   '{"text":"One.","thread":["One.","2","3","4","5","6","7","8","9"]}'),
  ('e2712000-0000-4000-8000-00000000000b', 'e2710000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Thread', 'in_review',
   '{"text":"One.","thread":["One.","Two.","Three.","Four.","Five."]}');
insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
select 'e2710000-0000-4000-8000-00000000000a', (select id from t where name = 'posts'), 'post', 'content_item', id, 'waiting_founder'
from public.content_items where user_id = 'e2710000-0000-4000-8000-00000000000a';
create temp table t_card on commit drop as
select c.idea as name, a.id, a.content_hash as hash, c.id as item
from public.approvals a join public.content_items c on c.id = a.ref_id
where a.ref_kind = 'content_item' and a.status = 'waiting' and c.user_id = 'e2710000-0000-4000-8000-00000000000a';
grant select on t_card to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2710000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_post_myself(%L, %L) $$, (select id from t_card where name = 'Thread'), (select hash from t_card where name = 'Thread')),
  'P0001', 'A thread is approved and scheduled from its card.', 'a valid thread is still refused');
select lives_ok(format($$ select public.cmo_post_myself(%L, %L) $$, (select id from t_card where name = 'Long'), (select hash from t_card where name = 'Long')),
  'a thread the card does not show is posted as its text');
reset role;
select is((select status from public.content_items where id = (select item from t_card where name = 'Long')), 'published', 'and is published');

select * from finish();
rollback;
