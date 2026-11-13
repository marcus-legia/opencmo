-- The posting plan (owner, 2026-11-12): the founder says which platforms get a post every day, how many, and how many
-- videos a week. Writer drafts to that plan instead of a fixed week. null = nobody chose yet, the app uses its default
-- (connected text platforms at one a day).
--
-- Shape: {"text": {"x": 0-3, "threads": 0-3, "linkedin": 0-3}, "video": {"tiktok": 0-7, "instagram": 0-7, "youtube": 0-7}}.
-- The same bounds live in apps/web/lib/cmo/posting-plan.ts; keep them together.

alter table public.profiles add column if not exists posting_plan jsonb;

create or replace function public.save_posting_plan(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_key text;
  v_val jsonb;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
     or jsonb_typeof(p_plan->'text') is distinct from 'object' or jsonb_typeof(p_plan->'video') is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_plan)) <> 2 then
    raise exception 'The posting plan needs a text and a video section.' using errcode = '22023';
  end if;

  if (select array_agg(k order by k) from jsonb_object_keys(p_plan->'text') k) is distinct from array['linkedin', 'threads', 'x'] then
    raise exception 'Posts a day are set for X, Threads and LinkedIn.' using errcode = '22023';
  end if;
  for v_key, v_val in select * from jsonb_each(p_plan->'text') loop
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric not between 0 and 3 then
      raise exception 'Posts a day must be between 0 and 3.' using errcode = '22023';
    end if;
  end loop;

  if (select array_agg(k order by k) from jsonb_object_keys(p_plan->'video') k) is distinct from array['instagram', 'tiktok', 'youtube'] then
    raise exception 'Videos a week are set for TikTok, Instagram and YouTube.' using errcode = '22023';
  end if;
  for v_key, v_val in select * from jsonb_each(p_plan->'video') loop
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric not between 0 and 7 then
      raise exception 'Videos a week must be between 0 and 7.' using errcode = '22023';
    end if;
  end loop;

  update public.profiles set posting_plan = p_plan where id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  return p_plan;
end;
$$;

revoke all on function public.save_posting_plan(jsonb) from public, anon;
grant execute on function public.save_posting_plan(jsonb) to authenticated;
