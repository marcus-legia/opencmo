-- 20270117010000: "Show it now" brings a held card into the queue, raises a card again for a post in review that lost
-- it, and works only for the card's owner.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

select ok(has_function_privilege('authenticated', 'public.approval_show_now(text,uuid)', 'execute'), 'a founder can call it');
select ok(not has_function_privilege('anon', 'public.approval_show_now(text,uuid)', 'execute'), 'anon cannot');

insert into auth.users (id, email) values
  ('e2950000-0000-4000-8000-00000000000a', 'shownow@test.local'),
  ('e2950000-0000-4000-8000-00000000000b', 'shownow-other@test.local');
update public.profiles set timezone = 'UTC' where id in ('e2950000-0000-4000-8000-00000000000a', 'e2950000-0000-4000-8000-00000000000b');

-- Eleven posts in review: the eleventh card is held. A twelfth post is in review with no card at all.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
select ('e2952000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'e2950000-0000-4000-8000-00000000000a', 'post', 'X',
  current_date, 'Post ' || g, 'in_review', jsonb_build_object('text', 'Post number ' || g || '.')
from generate_series(1, 12) g;
delete from public.approvals where user_id = 'e2950000-0000-4000-8000-00000000000a';
delete from public.card_budget where user_id = 'e2950000-0000-4000-8000-00000000000a';
select public.approval_raise('e2950000-0000-4000-8000-00000000000a', 'content_item', id)
from public.content_items where user_id = 'e2950000-0000-4000-8000-00000000000a' and id <> 'e2952000-0000-4000-8000-000000000012' order by id;

select is((select status from public.approvals where ref_id = 'e2952000-0000-4000-8000-000000000011' and status in ('waiting', 'held')), 'held',
  'the eleventh card is held');

-- Another founder cannot release it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2950000-0000-4000-8000-00000000000b"}';
select throws_ok($$ select public.approval_show_now('content_item', 'e2952000-0000-4000-8000-000000000011') $$, 'P0002',
  'This draft has no card to show.', 'not someone else''s card');

set local request.jwt.claims = '{"sub":"e2950000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.approval_show_now('content_item', 'e2952000-0000-4000-8000-000000000011') $$, 'the owner shows it now');
reset role;
select is((select status from public.approvals where ref_id = 'e2952000-0000-4000-8000-000000000011' and status in ('waiting', 'held')), 'waiting',
  'the held card waits in the queue');

-- The post with no card gets one, in the queue even though today's budget is spent.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2950000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.approval_show_now('content_item', 'e2952000-0000-4000-8000-000000000012') $$, 'a post without a card asks again');
reset role;
select is((select status from public.approvals where ref_id = 'e2952000-0000-4000-8000-000000000012' and status in ('waiting', 'held')), 'waiting',
  'its new card waits in the queue');

-- A post that is not in review has nothing to show.
update public.content_items set status = 'drafting' where id = 'e2952000-0000-4000-8000-000000000001';
update public.approvals set status = 'cancelled' where ref_id = 'e2952000-0000-4000-8000-000000000001' and status in ('waiting', 'held');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2950000-0000-4000-8000-00000000000a"}';
select throws_ok($$ select public.approval_show_now('content_item', 'e2952000-0000-4000-8000-000000000001') $$, 'P0002',
  'This draft has no card to show.', 'a draft out of review has no card');
reset role;

select * from finish();
rollback;
