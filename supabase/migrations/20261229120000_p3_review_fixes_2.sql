-- P3 review fixes, second round.
--
-- `caption_check` (20261229110000): a domain with a path ("acme.io/pricing") is a link too, as Writer's own check
-- holds (`URL_LIKE` in lib/cmo/jobs/check-post.ts). A bare domain stays allowed here: it may be the product's name
-- ("Cal.com"), and Writer's check already refuses one that is not.
--
-- A finished-video or shorts card approved with no work order behind it (the founder's own edit raised by hand) makes
-- no deliverable, so `deliverables_caption_rules` never approves its captions. Approving the card approves the
-- captions it showed, whether or not a deliverable follows.

-- The rules a caption keeps on its profile: its length, a title only on YouTube, no links, at most the profile's
-- hashtags. The same words for Writer and the founder.
create or replace function public.caption_check(p_profile text, p_text text, p_title text) returns void
language plpgsql immutable set search_path = public
as $$
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
  if concat_ws(' ', p_title, p_text) ~* '(https?://|www\.|\m[a-z0-9][a-z0-9-]*\.[a-z]{2,}/[^[:space:]])' then
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
revoke all on function public.caption_check(text, text, text) from public, anon, authenticated;

-- The captions a card showed are approved with it. One the founder edited on the card is approved too: the card's
-- hash covered the edit. Captions written after the card was decided are not on its snapshot and stay waiting.
create or replace function public.approvals_caption_approve() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.kind not in ('finished_video', 'shorts_batch') or new.status <> 'approved' or old.status <> 'waiting'
     or coalesce(jsonb_typeof(new.snapshot->'captions'), '') <> 'array' then
    return new;
  end if;
  update public.content_items c set status = 'approved', decided_at = coalesce(c.decided_at, now()), updated_at = now()
  where c.user_id = new.user_id and c.department = 'video' and c.status = 'in_review'
    and c.id in (select (e->>'caption_id')::uuid from jsonb_array_elements(new.snapshot->'captions') e
                 where e->>'caption_id' ~ '^[0-9a-f-]{36}$');
  return new;
end;
$$;
revoke all on function public.approvals_caption_approve() from public, anon, authenticated;
create trigger approvals_caption_approve after update of status on public.approvals
  for each row execute function public.approvals_caption_approve();
