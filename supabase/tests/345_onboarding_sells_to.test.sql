-- Wave 3 (20270201080000): "who do you sell to?" is checked, kept on the profile and written into the Strategy's ideal
-- customer; it replaces the website's guess, and a later edit by the founder is not overwritten by a re-apply.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

insert into auth.users (id, email) values ('e3450000-0000-4000-8000-00000000000a', 'sell-a@test.local');
insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e3450000-0000-4000-8000-00000000000a', 'strategy', 1, '{"icp": "Not stated on the website", "pains": ["late invoices"]}', 'agent');

select ok(not has_function_privilege('authenticated', 'public.cmo_apply_onboarding_answers(uuid, boolean, boolean)', 'execute'),
  'founders cannot call the apply step');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3450000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.cmo_onboarding_answers('{"sells_to": ""}') $$, '22023', 'Say who you sell to in 1 to 160 characters.', 'an empty answer is refused');
select throws_ok($$ select public.cmo_onboarding_answers('{"sells_to": 42}') $$, '22023', 'Say who you sell to in 1 to 160 characters.', 'text only');
select lives_ok($$ select public.cmo_onboarding_answers('{"sells_to": "  Freelance   designers with 5 to 20 clients "}') $$, 'a real answer is saved');
reset role;

select is((select sells_to from public.profiles where id = 'e3450000-0000-4000-8000-00000000000a'), 'Freelance designers with 5 to 20 clients',
  'kept on the profile, spaces tidied');
select is((select body->>'icp' || ' / ' || (body->'pains'->>0) || ' / ' || created_by from public.marketing_documents_latest
  where user_id = 'e3450000-0000-4000-8000-00000000000a' and kind = 'strategy'),
  'Freelance designers with 5 to 20 clients / late invoices / user', 'the founder''s words replace the guess, the rest is kept');

-- The founder edits the ideal customer; onboarding's re-apply leaves it.
insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e3450000-0000-4000-8000-00000000000a', 'strategy', 3, '{"icp": "Design studios of two or three"}', 'user');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3450000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_onboarding_answers('{}');
reset role;
select is((select body->>'icp' from public.marketing_documents_latest where user_id = 'e3450000-0000-4000-8000-00000000000a' and kind = 'strategy'),
  'Design studios of two or three', 'a later edit of their own is not overwritten');

select * from finish();
rollback;
