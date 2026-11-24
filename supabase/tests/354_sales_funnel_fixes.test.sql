-- 20270205010000: a scan the week plan did not order gets the job's price as its budget and a name that fits (no more
-- "Over budget … of 0 credits"); the DM gate is not a seller + DMs allowed + recent, and an address makes email ready.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(10);

insert into auth.users (id, email) values ('e3540000-0000-4000-8000-00000000000a', 'funnel@test.local');

-- A week root, then a scan nobody planned (Scan now).
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e3540000-0000-4000-8000-0000000000a1', 'e3540000-0000-4000-8000-00000000000a', 'plan_week', 'running');
select ok(public.cmo_plan_week('e3540000-0000-4000-8000-00000000000a', 'e3540000-0000-4000-8000-0000000000a1', '[]'::jsonb) >= 0,
  'the week has a root');
insert into public.cmo_runs (id, user_id, kind, status, input, credits) values
  ('e3540000-0000-4000-8000-0000000000a2', 'e3540000-0000-4000-8000-00000000000a', 'sales_scan', 'running', '{"source":"founder"}', 5);
select is((select budget_credits from public.work_orders where run_id = 'e3540000-0000-4000-8000-0000000000a2'), 5,
  'an unplanned scan is budgeted at its price');
select is((select title from public.work_orders where run_id = 'e3540000-0000-4000-8000-0000000000a2'), 'Find people asking',
  'and is called what it does');
select ok(public.work_order_spend((select id from public.work_orders where run_id = 'e3540000-0000-4000-8000-0000000000a2'), 5),
  'spending its price stays within budget');

-- A week with 2 credits free still gets the order, budgeted at what is left (review: it raised and left no order).
update public.work_orders r set budget_credits = r.spent_credits + 2 + coalesce((
  select sum(c.budget_credits - c.spent_credits) from public.work_orders c
  where c.parent_id = r.id and c.status not in ('done', 'failed', 'cancelled')), 0)
where r.user_id = 'e3540000-0000-4000-8000-00000000000a' and r.parent_id is null;
insert into public.cmo_runs (id, user_id, kind, status, input, credits) values
  ('e3540000-0000-4000-8000-0000000000a3', 'e3540000-0000-4000-8000-00000000000a', 'sales_scan', 'running', '{"source":"chat"}', 5);
select ok(exists (select 1 from public.work_orders where run_id = 'e3540000-0000-4000-8000-0000000000a3'), 'a scan past the free budget still has its order');
select is((select budget_credits from public.work_orders where run_id = 'e3540000-0000-4000-8000-0000000000a3'), 2,
  'budgeted at what the week has left');

-- The reach gate.
insert into public.opportunities (id, user_id, run_id, platform, url, community, title, score, reply) values
  ('e3540000-0000-4000-8000-0000000000c1', 'e3540000-0000-4000-8000-00000000000a', 'e3540000-0000-4000-8000-0000000000a2',
   'reddit', 'https://www.reddit.com/r/SaaS/comments/c1/first_customers/', 'SaaS', 'First customers', 66, 'Idea.'),
  ('e3540000-0000-4000-8000-0000000000c2', 'e3540000-0000-4000-8000-00000000000a', 'e3540000-0000-4000-8000-0000000000a2',
   'reddit', 'https://www.reddit.com/r/SaaS/comments/c2/agency/', 'SaaS', 'Agency', 64, 'Idea.'),
  ('e3540000-0000-4000-8000-0000000000c3', 'e3540000-0000-4000-8000-00000000000a', 'e3540000-0000-4000-8000-0000000000a2',
   'reddit', 'https://www.reddit.com/r/SaaS/comments/c3/email/', 'SaaS', 'Email', 62, 'Idea.');
select is(public.cmo_save_reach('e3540000-0000-4000-8000-00000000000a', 'e3540000-0000-4000-8000-0000000000a2', $j$[
  {"url": "https://www.reddit.com/r/SaaS/comments/c1/first_customers/",
   "reach": {"buyer": true, "wantsNow": false, "warm": false, "fresh": true, "dmAllowed": true, "asksForTools": false, "emailFound": null},
   "dm": "Saw your post about the first customers."},
  {"url": "https://www.reddit.com/r/SaaS/comments/c2/agency/",
   "reach": {"buyer": false, "wantsNow": true, "warm": true, "fresh": true, "dmAllowed": true, "asksForTools": true, "emailFound": null},
   "dm": "Not kept"},
  {"url": "https://www.reddit.com/r/SaaS/comments/c3/email/",
   "reach": {"buyer": true, "wantsNow": false, "warm": false, "fresh": true, "dmAllowed": true, "asksForTools": false, "emailFound": "sam@studio.example"}}
]$j$), 3, 'three checks saved');
select is((select reach_level || ' / ' || coalesce(dm_draft, '-') from public.opportunities where id = 'e3540000-0000-4000-8000-0000000000c1'),
  'dm_ready / Saw your post about the first customers.', 'someone with the problem in a place that allows DMs is DM ready, not warm or not');
select is((select reach_level || ' / ' || coalesce(dm_draft, '-') from public.opportunities where id = 'e3540000-0000-4000-8000-0000000000c2'),
  'reply_first / -', 'a seller stays reply first, however warm');
select is((select reach_level from public.opportunities where id = 'e3540000-0000-4000-8000-0000000000c3'), 'email_ready',
  'an address they published makes email ready without an answer');

select * from finish();
rollback;
