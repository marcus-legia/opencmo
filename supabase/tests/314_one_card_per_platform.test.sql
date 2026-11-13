-- 20270122010000: the founder's own video goes out one card per platform. No card for the video itself: each caption
-- Writer saves proposes its platform's time on a schedule card that shows the caption, which the founder can change
-- there. Approving the card approves the caption and the time; skipping it skips the caption, so its platform is not
-- asked again. A platform with no connected account is approved too (download and copy).
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

select ok(not has_function_privilege('authenticated', 'public.post_video_ready(public.work_orders,uuid)', 'execute'),
  'only the render rule makes a video ready');
select ok(not has_function_privilege('authenticated', 'public.schedule_caption_decided(public.schedule_slots,text)', 'execute'),
  'only a decision carries to the caption');

insert into auth.users (id, email) values ('e3140000-0000-4000-8000-00000000000a', 'cards@test.local');
update public.profiles set plan = 'starter', timezone = 'UTC' where id = 'e3140000-0000-4000-8000-00000000000a';
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3140000-0000-4000-8000-00000000000a","role":"authenticated"}';
insert into t select 'clip', public.create_blank_edit('Seven slides', '9:16');
reset role;
insert into public.editor_projects (clip_id, document) select id, '{"version": 1}'::jsonb from t;
set local role authenticated;
select public.mark_finished((select id from t where name = 'clip'),
  (select public.editor_document_hash(document) from public.editor_projects where clip_id = (select id from t where name = 'clip')));
reset role;
with r as (
  insert into public.tasks (user_id, kind, clip_id, settings_hash, status, request_id, output_path, output)
  select 'e3140000-0000-4000-8000-00000000000a', 'render_document', p.clip_id, public.editor_document_hash(p.document), 'done',
    gen_random_uuid(), 'e3140000-0000-4000-8000-00000000000a/' || p.clip_id || '/x.mp4', '{}'
  from public.editor_projects p where p.clip_id = (select id from t where name = 'clip')
  returning id)
insert into t select 'render', id from r;
set local role authenticated;
insert into t select 'order', public.post_video_start((select id from t where name = 'clip'), (select id from t where name = 'render'));
reset role;
update public.tasks set status = 'done', output = '{"pass":true,"round":0,"note":"","files":[]}'
where id = (select task_id from public.look_checks where order_id = (select id from t where name = 'order'));

-- Writer saves two captions: each proposes its platform's card, with its words.
select public.cmo_save_caption('e3140000-0000-4000-8000-00000000000a', null, (select id from t where name = 'clip'), 'tiktok_caption',
  'Seven slides on how I plan a week. #buildinpublic');
select public.cmo_save_caption('e3140000-0000-4000-8000-00000000000a', null, (select id from t where name = 'clip'), 'instagram_caption',
  'How I plan a week, in seven slides. #buildinpublic');
create function pg_temp.card(p text) returns uuid language sql as $$
  select a.id from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where a.ref_kind = 'schedule_slot' and a.status = 'waiting' and s.platform = p
    and s.user_id = 'e3140000-0000-4000-8000-00000000000a' $$;
grant execute on function pg_temp.card(text) to authenticated;
select is((select count(*)::int from public.approvals where user_id = 'e3140000-0000-4000-8000-00000000000a' and status = 'waiting'), 2,
  'two cards, one per platform, and none for the video');
select is((select snapshot->>'text' from public.approvals where id = pg_temp.card('instagram')),
  'How I plan a week, in seven slides. #buildinpublic', 'the card shows its platform''s caption');

-- The founder changes the Instagram caption on its card: the same card, new words, a new hash.
insert into t select 'ig', pg_temp.card('instagram');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3140000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.approval_decide(pg_temp.card('instagram'), 'edit_caption', jsonb_build_object(
  'content_hash', (select content_hash from public.approvals where id = pg_temp.card('instagram')), 'text', 'My week, planned in seven slides.'));
reset role;
select is((select a.id = (select id from t where name = 'ig') and a.snapshot->>'text' = 'My week, planned in seven slides.'
  from public.approvals a where a.id = pg_temp.card('instagram')), true, 'the same card shows the new words');
select is((select body->>'text' from public.content_items where clip_id = (select id from t where name = 'clip') and platform = 'instagram_caption'),
  'My week, planned in seven slides.', 'the caption is changed');

-- Approved with no Instagram account: download and copy, the time is kept and the caption approved.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3140000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.approval_decide(pg_temp.card('instagram'), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = pg_temp.card('instagram')))) $$,
  'a video with no connected account is approved');
reset role;
select is((select status || ' ' || mode from public.schedule_slots where platform = 'instagram' and user_id = 'e3140000-0000-4000-8000-00000000000a'),
  'waiting intent', 'its time is kept, for the founder to post');
select is((select status from public.content_items where clip_id = (select id from t where name = 'clip') and platform = 'instagram_caption'),
  'approved', 'approving the card approved the caption');

-- Skipped on TikTok: its caption is skipped, and a caption saved later asks only for its own platform.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3140000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.approval_decide(pg_temp.card('tiktok'), 'cancel',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = pg_temp.card('tiktok'))));
reset role;
select is((select status from public.content_items where clip_id = (select id from t where name = 'clip') and platform = 'tiktok_caption'),
  'skipped', 'skipping the card skipped the caption');
select public.cmo_save_caption('e3140000-0000-4000-8000-00000000000a', null, (select id from t where name = 'clip'), 'youtube',
  'How I plan a week, in seven slides.', 'My week in seven slides');
select is((select string_agg(platform || ' ' || status, ', ' order by platform, status) from public.schedule_slots
  where user_id = 'e3140000-0000-4000-8000-00000000000a'), 'instagram waiting, tiktok cancelled, youtube proposed',
  'YouTube is asked, TikTok is not asked again');
select ok(pg_temp.card('youtube') is not null, 'with its card');

-- A card whose caption changed after it was read is refused, as any card is.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3140000-0000-4000-8000-00000000000a","role":"authenticated"}';
create temp table yt on commit drop as select content_hash from public.approvals where id = pg_temp.card('youtube');
select public.approval_decide(pg_temp.card('youtube'), 'edit_caption', jsonb_build_object(
  'content_hash', (select content_hash from yt), 'text', 'A week, in seven slides.'));
select throws_ok($$ select public.approval_decide(pg_temp.card('youtube'), 'approve', jsonb_build_object('content_hash', (select content_hash from yt))) $$,
  'P0001', 'This card changed. Look at it again before deciding.', 'the old words cannot be approved');
reset role;

select * from finish();
rollback;
