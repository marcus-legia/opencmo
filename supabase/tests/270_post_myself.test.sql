-- cmo-review-2 S2.6 (20270111200000): "I posted it" on a post draft with no connected account approves it and marks it
-- posted in one transaction; the schedule card the approval proposed is dropped. A connected platform, a thread and
-- another founder's card are refused.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

select ok(has_function_privilege('authenticated', 'public.cmo_post_myself(uuid,text,text)', 'execute'), 'founders call it');
select ok(not has_function_privilege('anon', 'public.cmo_post_myself(uuid,text,text)', 'execute'), 'anon does not');

insert into auth.users (id, email) values
  ('e2700000-0000-4000-8000-00000000000a', 'pm-a@test.local'),
  ('e2700000-0000-4000-8000-00000000000b', 'pm-b@test.local');
-- Posting needs a plan since cmo-review-3 A3 (20270114050000); these founders decide and post, so they have one.
update public.profiles set plan = 'starter' where id in ('e2700000-0000-4000-8000-00000000000a', 'e2700000-0000-4000-8000-00000000000b');
update public.profiles set timezone = 'UTC' where id = 'e2700000-0000-4000-8000-00000000000a';
select public.zernio_profile_save('e2700000-0000-4000-8000-00000000000a', 'prof-pm');
select public.social_account_save('e2700000-0000-4000-8000-00000000000a', 'threads', '@founder', null, 'acc-pm-threads');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e2701000-0000-4000-8000-00000000000a', 'e2700000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'done');

-- An X post (no X account), a Threads post (Threads connected) and an X thread, each waiting on its card.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2702000-0000-4000-8000-00000000000a', 'e2700000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Mine', 'in_review',
   '{"text":"Posted it myself."}'),
  ('e2702000-0000-4000-8000-00000000000b', 'e2700000-0000-4000-8000-00000000000a', 'post', 'Threads', current_date, 'Connected', 'in_review',
   '{"text":"Goes out from the account."}'),
  ('e2702000-0000-4000-8000-00000000000c', 'e2700000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Thread', 'in_review',
   '{"text":"One.","thread":["One.","Two.","Three.","Four.","Five."]}');
insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
select 'e2700000-0000-4000-8000-00000000000a', 'e2701000-0000-4000-8000-00000000000a', 'post', 'content_item', id, 'waiting_founder'
from public.content_items where user_id = 'e2700000-0000-4000-8000-00000000000a';

create temp table t_card on commit drop as
select c.idea as name, a.id, a.content_hash as hash, c.id as item
from public.approvals a join public.content_items c on c.id = a.ref_id
where a.ref_kind = 'content_item' and a.status = 'waiting' and c.user_id = 'e2700000-0000-4000-8000-00000000000a';
grant select on t_card to authenticated;
select is((select count(*)::int from t_card), 3, 'each draft has its card');

-- Another founder cannot use the card.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2700000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_post_myself(%L, %L) $$, (select id from t_card where name = 'Mine'), (select hash from t_card where name = 'Mine')),
  'P0002', 'Post not found.', 'another founder''s card is not found');

set local request.jwt.claims = '{"sub":"e2700000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_post_myself(%L, %L) $$, (select id from t_card where name = 'Connected'), (select hash from t_card where name = 'Connected')),
  'P0001', 'This post goes out from your connected account. Approve it and pick its time instead.', 'a connected platform is refused');
select throws_ok(format($$ select public.cmo_post_myself(%L, %L) $$, (select id from t_card where name = 'Thread'), (select hash from t_card where name = 'Thread')),
  'P0001', 'A thread is approved and scheduled from its card.', 'a thread is refused');
select throws_ok(format($$ select public.cmo_post_myself(%L, %L) $$, (select id from t_card where name = 'Mine'), repeat('0', 64)),
  'P0001', 'This card changed. Look at it again before deciding.', 'an old hash is refused');

select is((public.cmo_post_myself((select id from t_card where name = 'Mine'), (select hash from t_card where name = 'Mine'), 'Posted it myself, edited.')).status,
  'edited', 'the card is decided, as edited');
reset role;

select is((select status || ' / ' || final_text from public.content_items where id = (select item from t_card where name = 'Mine')),
  'published / Posted it myself, edited.', 'the post is published with the words the founder posted');
select is((select count(*)::int from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
  where d.ref_id = (select item from t_card where name = 'Mine') and s.status in ('proposed', 'waiting', 'due', 'reminded')), 0,
  'no slot is left to remind or post it');
select is((select count(*)::int from public.approvals a join public.schedule_slots s on a.ref_kind = 'schedule_slot' and a.ref_id = s.id
  join public.deliverables d on d.id = s.deliverable_id
  where d.ref_id = (select item from t_card where name = 'Mine') and a.status = 'waiting'), 0, 'and no schedule card waits');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2700000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_post_myself(%L, %L) $$, (select id from t_card where name = 'Mine'), (select hash from t_card where name = 'Mine')),
  'P0001', 'This card was already decided.', 'it is done once');
reset role;

select * from finish();
rollback;
