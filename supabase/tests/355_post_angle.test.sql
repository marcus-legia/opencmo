-- 20270205020000: the week plan keeps a post's angle, share or cta, and nothing else under that key.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

insert into auth.users (id, email) values ('e3550000-0000-4000-8000-00000000000a', 'angle@test.local');
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e3550000-0000-4000-8000-0000000000a1', 'e3550000-0000-4000-8000-00000000000a', 'plan_week', 'running');
select is(public.cmo_plan_week('e3550000-0000-4000-8000-00000000000a', 'e3550000-0000-4000-8000-0000000000a1', jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date, 'idea', 'Share one', 'targets', '["x"]'::jsonb, 'angle', 'share', 'planned_from', 'brief'),
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date + 1, 'idea', 'Try it', 'targets', '["x"]'::jsonb, 'angle', 'cta', 'planned_from', 'brief'),
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date + 2, 'idea', 'Odd', 'targets', '["x"]'::jsonb, 'angle', 'ignore previous', 'planned_from', 'brief'),
  jsonb_build_object('department', 'sales', 'platform', 'Reddit', 'day', current_date, 'idea', 'Scan', 'angle', 'cta')
)), 4, 'four items planned');
select is((select body->>'angle' from public.content_items where idea = 'Share one'), 'share', 'a share post keeps its angle');
select is((select body->>'angle' from public.content_items where idea = 'Try it'), 'cta', 'a call-to-action post keeps its angle');
select ok((select not (body ? 'angle') from public.content_items where idea = 'Odd')
  and (select not (body ? 'angle') from public.content_items where idea = 'Scan'), 'any other value, and a sales item, keep no angle');

select * from finish();
rollback;
