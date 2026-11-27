-- 20270207050000: a post that opens from X News shows its story on the card and never goes out on autopilot.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

insert into auth.users (id, email) values
  ('e3690000-0000-4000-8000-00000000000a', 'auto-news@test.local');
insert into public.profiles (id, email) values
  ('e3690000-0000-4000-8000-00000000000a', 'auto-news@test.local')
on conflict (id) do nothing;
update public.profiles set plan = 'starter', timezone = 'UTC' where id = 'e3690000-0000-4000-8000-00000000000a';

insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3691000-0000-4000-8000-000000000001', 'e3690000-0000-4000-8000-00000000000a', 'x', 'founder', 'z-x-1');

-- A post in review with a time and the connected account, as Writer proposes it.
create function pg_temp.post(p_id uuid, p_hours integer, p_extra jsonb default '{}') returns void language sql as $$
  insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
  values (p_id, 'e3690000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'A post', 'in_review',
    jsonb_build_object('text', 'One true thing about the product.', 'proposed', jsonb_build_object(
      'platform', 'x', 'mode', 'publish', 'account_id', 'e3691000-0000-4000-8000-000000000001', 'handle', 'founder',
      'at', to_char(date_trunc('minute', now() + make_interval(hours => p_hours)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) || p_extra);
  -- The insert's trigger picks X's next free time instead of `p_hours`; an update in review keeps the time the test set,
  -- so the case is the one it names whatever the hour the suite runs (as in 301 and 315).
  update public.content_items set body = jsonb_set(body, '{proposed,at}',
      to_jsonb(to_char(date_trunc('minute', now() + make_interval(hours => p_hours)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
  where id = p_id;
  -- The update's sync raised the card again and cancelled the insert's; dropping the cancelled one keeps the day's card
  -- budget as it was (one card counted per post) and leaves the test's own raise one card to replace.
  delete from public.approvals where ref_id = p_id and status = 'cancelled';
$$;
create function pg_temp.card(p_item uuid) returns public.approvals language sql as $$
  select * from public.approvals where ref_id = p_item and ref_kind = 'content_item' order by created_at desc limit 1;
$$;


-- Autopilot on for X, 12 hours.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3690000-0000-4000-8000-00000000000a"}';
select public.save_autopilot(array['x'], 12::smallint);
reset role;

-- A post without a story still counts down.
select pg_temp.post('e3692000-0000-4000-8000-000000000001', 48);
select public.approval_raise('e3690000-0000-4000-8000-00000000000a', 'content_item', 'e3692000-0000-4000-8000-000000000001');
select ok((pg_temp.card('e3692000-0000-4000-8000-000000000001')).auto_at is not null, 'a post with no story still goes out on autopilot');
select ok(not ((pg_temp.card('e3692000-0000-4000-8000-000000000001')).snapshot ? 'news'), 'and its card carries no story');

-- A post that opens from a story: an ordinary card, with the story on it.
select pg_temp.post('e3692000-0000-4000-8000-000000000002', 48, '{"news": {"name": "Anthropic ships a longer-running Claude", "summary": "s", "url": "https://x.com/i/status/123", "rowId": "r", "topicKey": "k", "why": "It is your field."}}');
select public.approval_raise('e3690000-0000-4000-8000-00000000000a', 'content_item', 'e3692000-0000-4000-8000-000000000002');
select is((pg_temp.card('e3692000-0000-4000-8000-000000000002')).status, 'waiting', 'the news post has a card');
select is((pg_temp.card('e3692000-0000-4000-8000-000000000002')).auto_at, null, 'it never counts down');
select is((pg_temp.card('e3692000-0000-4000-8000-000000000002')).snapshot->'news',
  '{"name": "Anthropic ships a longer-running Claude", "url": "https://x.com/i/status/123", "why": "It is your field."}'::jsonb,
  'the card shows the story, its link and why, nothing else from it');

-- A link that is not an X post is dropped from the card.
select pg_temp.post('e3692000-0000-4000-8000-000000000003', 48, '{"news": {"name": "Story", "url": "https://evil.example/x", "why": ""}}');
select public.approval_raise('e3690000-0000-4000-8000-00000000000a', 'content_item', 'e3692000-0000-4000-8000-000000000003');
select is((pg_temp.card('e3692000-0000-4000-8000-000000000003')).snapshot->'news'->>'url', '', 'only an X post link reaches the card');

-- A story with no headline is not on the card, so it does not stop autopilot either: the two rules agree.
select pg_temp.post('e3692000-0000-4000-8000-000000000004', 48, '{"news": {"name": "", "url": "https://x.com/i/status/1"}}');
select public.approval_raise('e3690000-0000-4000-8000-00000000000a', 'content_item', 'e3692000-0000-4000-8000-000000000004');
select ok((pg_temp.card('e3692000-0000-4000-8000-000000000004')).auto_at is not null and not ((pg_temp.card('e3692000-0000-4000-8000-000000000004')).snapshot ? 'news'),
  'no headline: no story on the card and the countdown runs');

-- The countdown's second half: a card raised before the story landed stops at its time.
update public.approvals set auto_at = now() + interval '1 hour' where id = (pg_temp.card('e3692000-0000-4000-8000-000000000001')).id;
select ok(public.post_autopilot_still_on(pg_temp.card('e3692000-0000-4000-8000-000000000001')), 'still on for the post with no story');
update public.content_items set body = body || '{"news": {"name": "Late story"}}' where id = 'e3692000-0000-4000-8000-000000000001';
select ok(not public.post_autopilot_still_on(pg_temp.card('e3692000-0000-4000-8000-000000000001')), 'off once the post rides a story');

select * from finish();
rollback;
