-- Groups 4 and 5, item 5.1 (docs/plans/cmo/2026-11-10-groups-4-5-plan.md §4.4): a subreddit's rules read into one of
-- four states instead of three, plus what a member needs before posting there.
--
--   safe                 the rules let members name their own work;
--   requires_disclosure  they let it, but only with the relation stated ("I make X");
--   no_product_mention   help only: no self-promotion (was `help_only`);
--   not_verified         the rules could not be read: help only, and the card says so;
--   skip                 the community is not a place for this at all (kept as it was).
--
-- `mention_ok` and `help_only` stay valid in both checks so a scan that was running across the deploy, or an inbox
-- replay, does not fail its insert; the backfill moves every stored row to the new values, and the app maps the old
-- ones on read.

begin;

alter table public.subreddit_rules drop constraint if exists subreddit_rules_verdict_check;
alter table public.subreddit_rules add constraint subreddit_rules_verdict_check check (verdict in (
  'safe', 'requires_disclosure', 'no_product_mention', 'not_verified', 'skip', 'mention_ok', 'help_only'));
-- What the rules page states, when it states it: a karma floor, an account age, and whether self-promotion is kept to
-- a megathread. Null means the rules do not say.
alter table public.subreddit_rules add column if not exists min_karma integer check (min_karma between 0 and 1000000);
alter table public.subreddit_rules add column if not exists min_account_age_days integer check (min_account_age_days between 0 and 3650);
alter table public.subreddit_rules add column if not exists megathread boolean not null default false;

alter table public.opportunities drop constraint if exists opportunities_rule_check;
alter table public.opportunities add constraint opportunities_rule_check check (rule in (
  'safe', 'requires_disclosure', 'no_product_mention', 'not_verified', 'skip', 'mention_ok', 'help_only'));
-- The card shows the requirement next to the draft: the founder knows before pasting whether their account can post.
alter table public.opportunities add column if not exists min_karma integer check (min_karma between 0 and 1000000);
alter table public.opportunities add column if not exists min_account_age_days integer check (min_account_age_days between 0 and 3650);

-- Old values → new ones. Idempotent: a second call finds nothing to change.
create or replace function public.sales_rules_backfill() returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_rules integer;
  v_opps integer;
begin
  update public.subreddit_rules set verdict = case verdict when 'mention_ok' then 'safe' else 'no_product_mention' end
  where verdict in ('mention_ok', 'help_only');
  get diagnostics v_rules = row_count;
  update public.opportunities set rule = case rule when 'mention_ok' then 'safe' else 'no_product_mention' end
  where rule in ('mention_ok', 'help_only');
  get diagnostics v_opps = row_count;
  return v_rules + v_opps;
end;
$$;
revoke all on function public.sales_rules_backfill() from public, anon, authenticated;
grant execute on function public.sales_rules_backfill() to service_role;

select public.sales_rules_backfill();

-- The scan saves the new states and the requirement; old values are still taken and mapped.
CREATE OR REPLACE FUNCTION public.cmo_save_opportunities(p_user uuid, p_run uuid, p_items jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_score integer;
  v_gen jsonb;
  v_rule text;
  v_karma integer;
  v_age integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 10 then
    raise exception 'These conversations are not valid.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_score := least(100, greatest(0, coalesce((v_item->>'score')::integer, 0)));
    v_gen := case when jsonb_typeof(v_item->'gen') = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'model', left(v_item->'gen'->>'model', 100),
      'prompt_version', left(v_item->'gen'->>'prompt_version', 40))) else '{}'::jsonb end;
    -- The subreddit's rule the draft was written under (P5 R1, 5.1); a skipped thread is kept without a draft.
    v_rule := case v_item->>'rule'
      when 'mention_ok' then 'safe'
      when 'help_only' then 'no_product_mention'
      else case when v_item->>'rule' in ('safe', 'requires_disclosure', 'no_product_mention', 'not_verified', 'skip') then v_item->>'rule' end
    end;
    if v_rule is distinct from 'skip' and coalesce(v_item->>'reply', '') = '' then
      continue;
    end if;
    if coalesce(v_item->>'platform', 'reddit') not in ('reddit', 'hn') then
      raise exception 'A conversation comes from Reddit or Hacker News.' using errcode = '22023';
    end if;
    -- Clamped while still numeric: a huge number (1e10) cast to integer first would abort the whole scan's save.
    v_karma := case when jsonb_typeof(v_item->'min_karma') = 'number' and (v_item->>'min_karma')::numeric between 0 and 1000000
      then (v_item->>'min_karma')::numeric::integer end;
    v_age := case when jsonb_typeof(v_item->'min_account_age_days') = 'number' and (v_item->>'min_account_age_days')::numeric between 0 and 3650
      then (v_item->>'min_account_age_days')::numeric::integer end;
    insert into public.opportunities (
      user_id, run_id, platform, url, community, title, author, snippet, posted_at, comments, score, score_parts, reply,
      priority, gen, rule, rule_why, min_karma, min_account_age_days
    ) values (
      p_user, p_run, coalesce(v_item->>'platform', 'reddit'), v_item->>'url', left(coalesce(v_item->>'community', ''), 100),
      left(v_item->>'title', 400),
      left(coalesce(v_item->>'author', ''), 100), left(coalesce(v_item->>'snippet', ''), 1200),
      nullif(v_item->>'posted_at', '')::timestamptz, greatest(0, coalesce((v_item->>'comments')::integer, 0)),
      v_score, coalesce(v_item->'score_parts', '[]'::jsonb),
      case when v_rule = 'skip' then null else left(v_item->>'reply', 3000) end,
      case when v_score >= 85 then 'high' when v_score >= 70 then 'medium' else 'low' end,
      v_gen, v_rule, left(nullif(trim(coalesce(v_item->>'rule_why', '')), ''), 200),
      case when v_karma between 0 and 1000000 then v_karma end,
      case when v_age between 0 and 3650 then v_age end
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

-- The reply card carries the requirement (5.1); the rest is as it was.
CREATE OR REPLACE FUNCTION public.approval_snapshot(p_ref_kind text, p_ref_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v jsonb;
  v_look public.look_checks;
  v_extra jsonb;
begin
  -- The week plan card (cmo-review B2.1): the week's calendar as the brain planned it. Status stays out, so drafting a
  -- post does not change the card the founder is reading; an item they drop leaves it.
  if p_ref_kind = 'work_order' then
    -- A script the founder records (owner, 2026-11-09): the card of the `script` kind, free, read from the brief.
    select case when o.kind = 'write_video_brief' then jsonb_build_object('kind', 'script', 'step_id', o.id, 'clip_id', '',
        'tool', 'script_item', 'title', left(coalesce(o.brief->>'objective', o.title), 200),
        'seconds', o.brief->'seconds', 'aspect', o.brief->'aspect', 'price_credits', 0,
        'beats', coalesce((select jsonb_agg(jsonb_build_object('words', left(b->>'say', 300),
            'picture', left(case b->>'shot' when 'talking_head' then 'To camera: ' when 'screen' then 'Screen: ' else 'You film: ' end
              || coalesce(b->>'show', ''), 300), 'motion', null) order by n)
          from jsonb_array_elements(o.brief->'storyboard') with ordinality as s(b, n)), '[]'::jsonb)) end
    into v from public.work_orders o where o.id = p_ref_id;
    if v is not null then
      return v;
    end if;
    return public.plan_snapshot(p_ref_id);
  end if;
  v := public.approval_snapshot_base(p_ref_kind, p_ref_id);
  if v is null then
    return v;
  end if;
  if p_ref_kind = 'content_item' then
    -- A thread (P6 W4) and the time the post goes out (cmo-review-3 1.2): both are what the founder approves.
    select coalesce(case when public.thread_valid(c.body) then jsonb_build_object('thread', c.body->'thread') end, '{}'::jsonb)
        || case when p.proposed is null then '{}'::jsonb else jsonb_build_object('proposed', p.proposed) end
      into v_extra
    from public.content_items c cross join lateral (select public.post_proposal_snapshot(c.body) as proposed) p
    where c.id = p_ref_id;
    return v || coalesce(v_extra, '{}'::jsonb);
  end if;
  if p_ref_kind = 'opportunity' then
    -- 5.1: what a member needs before posting there, when the rules say it.
    select coalesce(case when platform <> 'reddit' then jsonb_build_object('platform', platform) end, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('min_karma', min_karma, 'min_account_age_days', min_account_age_days))
      into v_extra
    from public.opportunities where id = p_ref_id;
    return v || coalesce(v_extra, '{}'::jsonb);
  end if;
  if p_ref_kind not in ('editor_project', 'short_batch', 'studio_step') then
    return v;
  end if;
  select * into v_look from public.look_checks c
  where c.ref_kind = p_ref_kind and c.ref_id = p_ref_id and c.status = 'failed'
    and c.doc_key = coalesce(v->>'document_hash', v->>'parent_hash')
  order by c.round desc, c.created_at desc limit 1;
  if found and coalesce(v_look.result->>'note', '') <> '' then
    v := v || jsonb_build_object('look', jsonb_build_object('pass', false, 'round', v_look.round,
      'note', left(v_look.result->>'note', 200)));
  end if;
  return v;
end;
$$;

commit;
