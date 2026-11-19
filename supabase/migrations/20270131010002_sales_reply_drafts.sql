-- Free scan A5: `sales_reply_drafts` saves the reply of a card the free scan left undrafted
-- (docs/plans/cmo/2026-11-18-free-scan-plan.md).
--
-- `cmo_save_opportunity_reply` fills one card's empty reply, once: only the founder's own card, still in review, not a
-- skipped thread, and only from one of their `sales_reply_drafts` runs. The job may tighten the card's rule to help
-- only (the community's rules changed, or the one product mention per ten replies is used); it can never loosen it.
-- Service role only, like `cmo_save_opportunities`.

create or replace function public.cmo_save_opportunity_reply(
  p_user uuid, p_run uuid, p_id uuid, p_reply text, p_gen jsonb, p_rule text default null, p_rule_why text default null
) returns boolean
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_reply text := btrim(coalesce(p_reply, ''), E' \t\n\r');
  v_gen jsonb := case when jsonb_typeof(p_gen) = 'object' then jsonb_strip_nulls(jsonb_build_object(
    'model', left(p_gen->>'model', 100), 'prompt_version', left(p_gen->>'prompt_version', 40))) else '{}'::jsonb end;
begin
  if v_reply = '' or char_length(v_reply) > 3000 then
    raise exception 'A reply is 1 to 3000 characters.' using errcode = '22023';
  end if;
  if p_rule is not null and p_rule <> 'no_product_mention' then
    raise exception 'A reply''s rule can only become help only.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.cmo_runs r where r.id = p_run and r.user_id = p_user and r.kind = 'sales_reply_drafts'
  ) then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  update public.opportunities o set
    reply = v_reply,
    gen = v_gen,
    rule = coalesce(p_rule, o.rule),
    rule_why = case when p_rule is null then o.rule_why else left(nullif(btrim(coalesce(p_rule_why, '')), ''), 200) end
  where o.id = p_id and o.user_id = p_user and o.status = 'in_review' and o.reply = '' and o.rule is distinct from 'skip';
  return found;
end;
$$;

revoke all on function public.cmo_save_opportunity_reply(uuid, uuid, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.cmo_save_opportunity_reply(uuid, uuid, uuid, text, jsonb, text, text) to service_role;
