-- 20270120027000: the caption Writer writes with a script goes on the script's order with the storyboard; one that
-- is too long is left out and the script still reaches the founder; a script written before captions is unchanged.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

insert into auth.users (id, email) values
  ('e3060000-0000-4000-8000-00000000000a', 'caption-a@test.local'),
  ('e3060000-0000-4000-8000-00000000000b', 'caption-b@test.local'),
  ('e3060000-0000-4000-8000-00000000000c', 'caption-c@test.local');
update public.profiles set credit_balance = 50 where id::text like 'e3060000-%';

-- A week plan's script whose Writer run ends with this caption (null: an output written before captions).
create function pg_temp.script(p_user uuid, p_caption text) returns uuid language plpgsql as $$
declare
  v_run uuid := gen_random_uuid();
  v_order uuid;
begin
  insert into public.cmo_insights (user_id, kind, body) values (p_user, 'niche_video', '{}');
  insert into public.cmo_runs (id, user_id, kind, status) values (v_run, p_user, 'plan_week', 'running');
  perform public.cmo_plan_week(p_user, v_run,
    jsonb_build_array(jsonb_build_object('day', current_date, 'department', 'video', 'platform', 'Shorts', 'idea', 'A demo', 'reason', 'r')));
  select id into v_order from public.work_orders where kind = 'write_video_brief' and user_id = p_user;
  update public.cmo_runs set status = 'done', finished_at = now(), output = jsonb_build_object('reason', 'r',
    'brief', jsonb_strip_nulls(jsonb_build_object('objective', 'Show the demo', 'hooks', jsonb_build_array('a', 'b', 'c'), 'seconds', 30,
      'aspect', '9:16', 'caption', p_caption,
      'storyboard', jsonb_build_array(jsonb_build_object('say', 'First words.', 'show', 'You', 'shot', 'talking_head', 'seconds', 10),
        jsonb_build_object('say', 'Second words.', 'show', 'Screen', 'shot', 'screen', 'seconds', 10),
        jsonb_build_object('say', 'Third words.', 'show', 'You', 'shot', 'talking_head', 'seconds', 10)))))
  where input->>'order_id' = v_order::text;
  return v_order;
end;
$$;

create temp table t (name text primary key, id uuid) on commit drop;
insert into t values
  ('with', pg_temp.script('e3060000-0000-4000-8000-00000000000a', E'First words.\n\nThe demo, in one take.\n\n#demo #founder')),
  ('long', pg_temp.script('e3060000-0000-4000-8000-00000000000b', repeat('x', 2201))),
  ('none', pg_temp.script('e3060000-0000-4000-8000-00000000000c', null));

select is((select brief->>'caption' from public.work_orders where id = (select id from t where name = 'with')),
  E'First words.\n\nThe demo, in one take.\n\n#demo #founder', 'the caption is on the order with the script');
select is((select jsonb_array_length(brief->'storyboard') from public.work_orders where id = (select id from t where name = 'with')), 3,
  'the storyboard is there as before');
select is((select count(*)::int from public.approvals where ref_kind = 'work_order' and ref_id = (select id from t where name = 'with') and status = 'waiting'), 1,
  'the script card is raised');

select ok(not (select brief ? 'caption' from public.work_orders where id = (select id from t where name = 'long')), 'a caption over 2,200 characters is left out');
select is((select count(*)::int from public.approvals where ref_kind = 'work_order' and ref_id = (select id from t where name = 'long') and status = 'waiting'), 1,
  'its script still reaches the founder');

select ok(not (select brief ? 'caption' from public.work_orders where id = (select id from t where name = 'none')), 'a script without a caption has none');
select is((select jsonb_array_length(brief->'storyboard') from public.work_orders where id = (select id from t where name = 'none')), 3,
  'and is a script all the same');

select * from finish();
rollback;
