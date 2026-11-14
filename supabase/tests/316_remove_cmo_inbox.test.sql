-- 20270124010000: the founder's Claude inbox is gone. Its table and functions are dropped, `brain` no longer makes a
-- paid founder's run free, the MCP read buckets are refused, `cmo_order_script` lost `p_brain`, and a run still
-- queued for the founder's Claude fails with a sentence (no credit was held for it).
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(16);

select hasnt_table('public', 'cmo_inbox', 'the inbox table is gone');
select hasnt_function('public', 'inbox_submit', 'inbox_submit is gone');
select hasnt_function('public', 'inbox_claim', 'inbox_claim is gone');
select hasnt_function('public', 'inbox_list', 'inbox_list is gone');
select hasnt_function('public', 'cmo_inbox_open', 'cmo_inbox_open is gone');
select hasnt_function('public', 'cmo_inbox_finish', 'cmo_inbox_finish is gone');
select hasnt_function('public', 'cmo_order_script', array['text', 'date', 'text'], 'cmo_order_script no longer takes a brain');
select ok(not has_function_privilege('authenticated', 'public.cmo_fail_claude_runs()', 'execute'), 'only the migration fails old Claude runs');

insert into auth.users (id, email) values
  ('e3160000-0000-4000-8000-00000000000a', 'no-inbox-paid@test.local'),
  ('e3160000-0000-4000-8000-00000000000b', 'no-inbox-old@test.local');
update public.profiles set plan = 'creator' where id in ('e3160000-0000-4000-8000-00000000000a', 'e3160000-0000-4000-8000-00000000000b');
insert into public.credit_ledger (user_id, delta, reason) values ('e3160000-0000-4000-8000-00000000000a', 20, 'test grant');

-- The money line: a paid founder who still sends brain = claude pays the normal price, and the run keeps no brain.
create temp table r1 (like public.cmo_runs) on commit drop;
grant all on r1 to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3160000-0000-4000-8000-00000000000a"}';
insert into r1 select * from public.enqueue_cmo_run('post_draft', '{"brain":"claude","idea":"Late invoices"}');
select is((select credits from r1), public.cmo_job_price('post_draft'), 'brain = claude is charged like any run');
select is((select input ? 'brain' from r1), false, 'the run keeps no brain');
select is((public.enqueue_cmo_run('post_draft', '{"idea":"Late invoices"}')).id, (select id from r1), 'the same request without brain is the same run');
select is((select (public.enqueue_cmo_run('sales_scan', '{"inbox":"e3160000-0000-4000-8000-0000000000ff"}')).input ? 'inbox'), false,
  'an inbox key is dropped, not a way in');
select throws_ok($$ select public.cmo_read_hit('mcp_social') $$, '22023', 'Invalid rate limit.', 'the MCP social bucket is gone');
select throws_ok($$ select public.cmo_read_hit('mcp_site') $$, '22023', 'Invalid rate limit.', 'the MCP site bucket is gone');
reset role;

-- A run queued for the founder's Claude before the migration (as `inbox_submit` made them: 0 credits) fails, once.
insert into public.cmo_runs (user_id, kind, status, input, credits)
values ('e3160000-0000-4000-8000-00000000000b', 'plan_week', 'queued', '{"brain":"claude","inbox":"e3160000-0000-4000-8000-0000000000ee"}', 0);
select is(public.cmo_fail_claude_runs(), 1, 'the old Claude run is failed');
select is((select status || ': ' || error from public.cmo_runs where user_id = 'e3160000-0000-4000-8000-00000000000b'),
  'failed: This task was waiting for your own Claude, which OpenCMO no longer uses. Ask for it again.', 'with a sentence for the founder');

select * from finish();
rollback;
