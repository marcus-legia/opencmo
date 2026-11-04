-- cmo-review B3.1 + B3.2 (20270107010000): the brain cannot spend past the week's budget on its own; the founder
-- still can; spending too fast within an hour pauses the brain.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(8);

insert into auth.users (id, email) values ('e2500000-0000-4000-8000-00000000000a', 'b31@test.local');
update public.profiles set weekly_credit_budget = 8, credit_balance = 100 where id = 'e2500000-0000-4000-8000-00000000000a';
select public.work_order_week_root('e2500000-0000-4000-8000-00000000000a');
select is((select budget_credits from public.work_orders where user_id = 'e2500000-0000-4000-8000-00000000000a' and parent_id is null),
  8, 'the week has an 8 credit budget');

-- A brain-started sales scan (5) fits; two more do not.
select lives_ok($$ select public.cmo_enqueue('e2500000-0000-4000-8000-00000000000a', 'sales_scan', '{"source":"schedule","brief":"a"}') $$,
  'a scan within the budget starts');
select throws_ok($$ select public.cmo_enqueue('e2500000-0000-4000-8000-00000000000a', 'sales_scan', '{"source":"event","brief":"b"}') $$,
  'P0001', 'This week''s credit budget (8 credits) is used up. Raise it in Settings, or ask your CMO for this yourself.',
  'a second one, with the first still holding, would pass it');
select is((select count(*)::int from public.credit_ledger where user_id = 'e2500000-0000-4000-8000-00000000000a' and ref_kind = 'cmo_run'),
  1, 'nothing was held for the refused run');
select lives_ok($$ select public.cmo_enqueue('e2500000-0000-4000-8000-00000000000a', 'sales_scan', '{"source":"chat","brief":"c"}') $$,
  'the founder can still ask for it');

-- The cost ceiling: max(10, 40 % of 25) = 10 credits of brain work in an hour.
insert into auth.users (id, email) values ('e2500000-0000-4000-8000-00000000000b', 'b32@test.local');
update public.profiles set weekly_credit_budget = 25, credit_balance = 100 where id = 'e2500000-0000-4000-8000-00000000000b';
select public.work_order_week_root('e2500000-0000-4000-8000-00000000000b');
select public.cmo_enqueue('e2500000-0000-4000-8000-00000000000b', 'sales_scan', '{"source":"schedule","brief":"a"}');
select public.cmo_enqueue('e2500000-0000-4000-8000-00000000000b', 'competitor_research', '{"source":"schedule"}');
select public.cmo_enqueue('e2500000-0000-4000-8000-00000000000b', 'niche_video_research', '{"source":"event"}');
select public.cmo_enqueue('e2500000-0000-4000-8000-00000000000b', 'post_draft', '{"source":"schedule"}');
select is((select cmo_paused_at is not null from public.profiles where id = 'e2500000-0000-4000-8000-00000000000b'), false,
  '10 credits in an hour is at the limit, not past it');
select public.cmo_enqueue('e2500000-0000-4000-8000-00000000000b', 'write_slides', '{"source":"event","idea":"x"}');
select is((select cmo_paused_at is not null from public.profiles where id = 'e2500000-0000-4000-8000-00000000000b'), true,
  'past it, the brain pauses itself');
select ok(exists (select 1 from public.work_order_events where user_id = 'e2500000-0000-4000-8000-00000000000b' and text like 'Paused:%'),
  'and says why on the week');

select * from finish();
rollback;
