-- cmo-review-3 2.1 (20270113020000): a reason picked on every draft. Each chip is stored on the decision's outcome; a
-- chip that is an edit label is the founder's label, which the classifier never overwrites; two founder labels of a
-- kind propose a rule (skips count too); an unknown chip is refused; an approve as written keeps no label.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

select ok(not has_function_privilege('authenticated', 'public.cmo_label_outcome(uuid,uuid,text)', 'execute'), 'the label is written through approval_decide only');

insert into auth.users (id, email) values ('e2770000-0000-4000-8000-00000000000a', 'reasons-a@test.local');
update public.profiles set timezone = 'UTC' where id = 'e2770000-0000-4000-8000-00000000000a';

insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
select ('e2771000-0000-4000-8000-00000000000' || n)::uuid, 'e2770000-0000-4000-8000-00000000000a', 'post', 'X', current_date,
  'Post ' || n, 'in_review', jsonb_build_object('text', 'Our revolutionary app changes invoicing forever, number ' || n || '.')
from generate_series(1, 6) n;

create temp table t_card on commit drop as
select c.idea as name, a.id, a.content_hash as hash, c.id as item
from public.approvals a join public.content_items c on c.id = a.ref_id
where a.ref_kind = 'content_item' and a.status = 'waiting' and c.user_id = 'e2770000-0000-4000-8000-00000000000a';
grant select on t_card to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2770000-0000-4000-8000-00000000000a","role":"authenticated"}';

select throws_ok(format($$ select public.approval_decide(%L, 'skip', %L) $$, (select id from t_card where name = 'Post 1'),
  jsonb_build_object('content_hash', (select hash from t_card where name = 'Post 1'), 'reason_code', 'BORING')),
  '22023', 'Pick one of the reasons on the card.', 'an unknown chip is refused');

-- Skip with "Too salesy": stored, labelled by the founder, and the chip's name is the reason.
select is((public.approval_decide((select id from t_card where name = 'Post 1'), 'skip',
  jsonb_build_object('content_hash', (select hash from t_card where name = 'Post 1'), 'reason_code', 'TOO_SALESY'))).reason,
  'Too salesy', 'the chip''s name is the skip reason');
-- Skip with "Off topic" and words of their own: the words are the reason, the chip is kept.
select public.approval_decide((select id from t_card where name = 'Post 2'), 'skip',
  jsonb_build_object('content_hash', (select hash from t_card where name = 'Post 2'), 'reason_code', 'OFF_TOPIC', 'reason', 'We do not sell to agencies.'));
-- An edited approve with "Too salesy", and one approved as written with a chip it does not need.
select public.approval_decide((select id from t_card where name = 'Post 3'), 'approve',
  jsonb_build_object('content_hash', (select hash from t_card where name = 'Post 3'), 'reason_code', 'TOO_SALESY',
    'text', 'Invoices get paid when the reminder goes out on day three. That is the whole trick.'));
select public.approval_decide((select id from t_card where name = 'Post 4'), 'approve',
  jsonb_build_object('content_hash', (select hash from t_card where name = 'Post 4'), 'reason_code', 'TOO_LONG'));
reset role;

select is((select reason_code || ':' || labelled_by || ':' || edit_mode from public.cmo_draft_outcomes where item_id = 'e2771000-0000-4000-8000-000000000001'),
  'TOO_SALESY:founder:TOO_SALESY', 'a skip chip is the founder''s label');
select ok((select classified_at is not null from public.cmo_draft_outcomes where item_id = 'e2771000-0000-4000-8000-000000000001'), 'and counts as classified');
select is((select reason_code || ':' || coalesce(labelled_by, '-') || ':' || coalesce(edit_mode, '-') from public.cmo_draft_outcomes
  where item_id = 'e2771000-0000-4000-8000-000000000002'), 'OFF_TOPIC:-:-', 'off topic is kept, not an edit label');
select ok(exists (select 1 from public.cmo_memories where user_id = 'e2770000-0000-4000-8000-00000000000a' and body like '%We do not sell to agencies.%'),
  'the founder''s own words reach memory');
select is((select reason_code || ':' || labelled_by || ':' || edit_mode from public.cmo_draft_outcomes where item_id = 'e2771000-0000-4000-8000-000000000003'),
  'TOO_SALESY:founder:TOO_SALESY', 'an edited approve keeps the chip as its label');
select is((select coalesce(reason_code, '-') || ':' || edit_mode from public.cmo_draft_outcomes where item_id = 'e2771000-0000-4000-8000-000000000004'),
  '-:NO_MEANINGFUL_EDIT', 'an approve as written keeps no chip');

-- Two founder labels of a kind (a skip and an edit) propose the rule.
select is((select count(*)::int from public.cmo_corrections where user_id = 'e2770000-0000-4000-8000-00000000000a' and edit_mode = 'TOO_SALESY' and status = 'proposed'),
  1, 'two founder labels propose a rule');

-- The classifier does not overwrite a founder label, and it is not handed one.
set local role service_role;
select is(public.cmo_set_edit_mode((select id from public.cmo_draft_outcomes where item_id = 'e2771000-0000-4000-8000-000000000003'), 'WRONG_VOICE'),
  false, 'the classifier cannot relabel it');
select ok(not exists (select 1 from public.cmo_unclassified_outcomes(100) u
  join public.cmo_draft_outcomes o on o.id = u.id where o.labelled_by = 'founder'), 'nor is it handed one');
reset role;
select is((select edit_mode from public.cmo_draft_outcomes where item_id = 'e2771000-0000-4000-8000-000000000003'), 'TOO_SALESY', 'the founder''s label stays');

-- One model label alone proposes nothing (it still needs three).
insert into public.cmo_draft_outcomes (user_id, item_id, department, action, chosen_version, similarity, platform)
values ('e2770000-0000-4000-8000-00000000000a', 'e2771000-0000-4000-8000-000000000005', 'post', 'approve', 0, 0.4, 'x');
set local role service_role;
select public.cmo_set_edit_mode((select id from public.cmo_draft_outcomes where item_id = 'e2771000-0000-4000-8000-000000000005'), 'HOOK_REWRITTEN');
reset role;
select is((select count(*)::int from public.cmo_corrections where user_id = 'e2770000-0000-4000-8000-00000000000a' and edit_mode = 'HOOK_REWRITTEN'),
  0, 'one model label proposes nothing');

select * from finish();
rollback;
