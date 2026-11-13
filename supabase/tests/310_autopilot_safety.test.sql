-- 20270121020000: autopilot never approves a founder's own brief, a card the founder has not seen yet, or a card of
-- a banned account.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

insert into auth.users (id, email) values ('e3000000-0000-4000-8000-00000000000a', 'safe@test.local');
insert into public.profiles (id, email) values ('e3000000-0000-4000-8000-00000000000a', 'safe@test.local')
on conflict (id) do nothing;
update public.profiles set plan = 'starter', timezone = 'UTC', autopilot_platforms = array['x'], autopilot_hours = 12
where id = 'e3000000-0000-4000-8000-00000000000a';
insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3001000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-00000000000a', 'x', 'founder', 'z-x-300');

create function pg_temp.body(p_hours integer) returns jsonb language sql as $$
  select jsonb_build_object('text', 'One true thing about the product.', 'proposed', jsonb_build_object(
    'platform', 'x', 'mode', 'publish', 'account_id', 'e3001000-0000-4000-8000-000000000001', 'handle', 'founder',
    'at', to_char(date_trunc('minute', now() + make_interval(hours => p_hours)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
$$;
create function pg_temp.post(p_id uuid) returns void language sql as $$
  insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
  values (p_id, 'e3000000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'A post', 'in_review', pg_temp.body(48));
$$;
create function pg_temp.card(p_item uuid) returns public.approvals language sql as $$
  select * from public.approvals where ref_id = p_item and ref_kind = 'content_item' order by created_at desc limit 1;
$$;

insert into public.cmo_runs (id, user_id, kind, status, input) values
  ('e3002000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-00000000000a', 'post_draft', 'running', '{}'),
  ('e3002000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-00000000000a', 'post_draft', 'running',
   '{"idea":"Why invoices go unpaid"}');

-- 1. The founder's brief keeps its marker through the draft, and a "write it now" idea gets one.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e3003000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-00000000000a', 'post', 'X', current_date,
  'From the chat', 'planned', '{"source":"cmo_chat"}');
select public.cmo_save_draft('e3000000-0000-4000-8000-00000000000a', 'e3002000-0000-4000-8000-000000000001',
  'e3003000-0000-4000-8000-000000000001', 'From the chat', pg_temp.body(48));
select is((select body->>'source' from public.content_items where id = 'e3003000-0000-4000-8000-000000000001'), 'cmo_chat',
  'a chat brief is still the founder''s after it is drafted');
select public.approval_raise('e3000000-0000-4000-8000-00000000000a', 'content_item', 'e3003000-0000-4000-8000-000000000001');
select is((pg_temp.card('e3003000-0000-4000-8000-000000000001')).auto_at, null, 'so its card waits for the founder');

select is((public.cmo_save_draft('e3000000-0000-4000-8000-00000000000a', 'e3002000-0000-4000-8000-000000000002',
  null, 'Why invoices go unpaid', pg_temp.body(48))).body->>'source', 'cmo_chat', 'a brief from the run''s idea is the founder''s');
select is((public.cmo_save_draft('e3000000-0000-4000-8000-00000000000a', 'e3002000-0000-4000-8000-000000000001',
  null, '', pg_temp.body(48))).body->>'source', null, 'a post the CMO picked has no marker');

-- 2. A held card counts down only once the founder can see it.
select pg_temp.post('e3003000-0000-4000-8000-000000000002');
select public.approval_raise('e3000000-0000-4000-8000-00000000000a', 'content_item', 'e3003000-0000-4000-8000-000000000002');
update public.approvals set status = 'held', held_until = now() - interval '1 minute'
where ref_id = 'e3003000-0000-4000-8000-000000000002';
update public.approvals set auto_at = now() - interval '1 hour' where ref_id = 'e3003000-0000-4000-8000-000000000002';
select ok(public.approval_release_held() >= 1, 'the held card is released');
select ok((pg_temp.card('e3003000-0000-4000-8000-000000000002')).auto_at > now() + interval '11 hours',
  'its countdown starts when it is released, not when it was held');
select is(public.approval_auto_decide(), 0, 'so the same sweep does not approve it');

-- 3. A banned account approves nothing.
select pg_temp.post('e3003000-0000-4000-8000-000000000003');
select public.approval_raise('e3000000-0000-4000-8000-00000000000a', 'content_item', 'e3003000-0000-4000-8000-000000000003');
update public.approvals set auto_at = now() - interval '1 minute' where ref_id = 'e3003000-0000-4000-8000-000000000003';
update auth.users set banned_until = now() + interval '1 day' where id = 'e3000000-0000-4000-8000-00000000000a';
select is(public.approval_auto_decide(), 0, 'a banned account''s post is not approved');
select is((pg_temp.card('e3003000-0000-4000-8000-000000000003')).status || coalesce((pg_temp.card('e3003000-0000-4000-8000-000000000003')).auto_at::text, ' and no countdown'),
  'waiting and no countdown', 'its card stops counting down');

select * from finish();
rollback;
