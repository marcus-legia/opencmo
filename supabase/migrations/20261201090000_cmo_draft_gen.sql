-- Which model and prompt drafted each Reddit reply (agent evals plan, P1).
--
-- Post drafts carry it in `content_items.body.gen`; opportunities have no body, so they get a
-- column. Only two short strings are kept, whatever the caller sends, so the column cannot grow
-- into a place to store arbitrary data.

alter table public.opportunities
  add column gen jsonb not null default '{}'::jsonb
  constraint opportunities_gen_check check (jsonb_typeof(gen) = 'object' and octet_length(gen::text) <= 256);

create or replace function public.cmo_save_opportunities(p_user uuid, p_run uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_score integer;
  v_gen jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 10 then
    raise exception 'These conversations are not valid.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_score := least(100, greatest(0, coalesce((v_item->>'score')::integer, 0)));
    v_gen := case when jsonb_typeof(v_item->'gen') = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'model', left(v_item->'gen'->>'model', 100),
      'prompt_version', left(v_item->'gen'->>'prompt_version', 40))) else '{}'::jsonb end;
    insert into public.opportunities (
      user_id, run_id, url, community, title, author, snippet, posted_at, comments, score, score_parts, reply, priority, gen
    ) values (
      p_user, p_run, v_item->>'url', left(coalesce(v_item->>'community', ''), 100), left(v_item->>'title', 400),
      left(coalesce(v_item->>'author', ''), 100), left(coalesce(v_item->>'snippet', ''), 1200),
      nullif(v_item->>'posted_at', '')::timestamptz, greatest(0, coalesce((v_item->>'comments')::integer, 0)),
      v_score, coalesce(v_item->'score_parts', '[]'::jsonb), left(v_item->>'reply', 3000),
      case when v_score >= 85 then 'high' when v_score >= 70 then 'medium' else 'low' end,
      v_gen
    )
    on conflict (user_id, url) do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  update public.content_items set status = 'published', published_at = now(), updated_at = now()
  where user_id = p_user and department = 'sales' and status = 'planned' and day <= current_date;
  return v_count;
end;
$$;
