-- 20270105010000: review follow-ups (docs/plans/cmo/2026-11-02-review-followups-plan.md). Each block names its item.

begin;

-- Q8: a domain with a path is a link, but not a code file name such as "Next.js/React" (the same rule as `hasLink`
-- in apps/web/lib/cmo/jobs/check-post.ts; the cases are packages/contracts/link-cases.json).
create or replace function public.caption_check(p_profile text, p_text text, p_title text) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
declare
  v_profile jsonb := public.platform_profile(p_profile);
  v_label text := v_profile->>'label';
  v_tags integer;
begin
  if v_profile is null or v_profile->>'kind' not in ('caption', 'youtube') then
    raise exception 'Captions are for Instagram, TikTok and YouTube.' using errcode = '22023';
  end if;
  if p_text is null or char_length(trim(p_text)) = 0 or char_length(p_text) > (v_profile->>'limit')::integer then
    raise exception 'A % is 1 to % characters.', v_label, to_char((v_profile->>'limit')::integer, 'FM999,999') using errcode = '22023';
  end if;
  if v_profile->>'kind' = 'youtube' then
    if p_title is null or char_length(trim(p_title)) = 0 or char_length(p_title) > (v_profile->>'title')::integer then
      raise exception 'A YouTube title is 1 to % characters.', v_profile->>'title' using errcode = '22023';
    end if;
  elsif p_title is not null then
    raise exception 'Only YouTube has a title.' using errcode = '22023';
  end if;
  if concat_ws(' ', p_title, p_text) ~* '(https?://|www\.|\m[a-z0-9][a-z0-9-]*\.(?!(jsx?|tsx?|mjs|py|rb|css|html?|md|json|ya?ml|txt|sql|vue|svelte)/)[a-z]{2,}/[^[:space:]])' then
    raise exception 'Captions carry no links.' using errcode = '22023';
  end if;
  -- `countHashtags` in lib/cmo/platforms.ts: `#word` with a letter in it, not `#1` or `a#b`.
  select count(*) into v_tags
  from regexp_matches(concat_ws(' ', p_title, p_text), '(^|[^[:alnum:]_&/])#[[:alnum:]_]*[[:alpha:]][[:alnum:]_]*', 'g');
  if v_tags > (v_profile->>'hashtags')::integer then
    raise exception 'A % carries at most % hashtags.', v_label, v_profile->>'hashtags' using errcode = '22023';
  end if;
end;
$$;

commit;
