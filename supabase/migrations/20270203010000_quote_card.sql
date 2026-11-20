-- Wave 4b A4: a post may carry a quote card, an image made from a quote of a Library entry of the founder (plan
-- docs/plans/cmo/2026-11-20-wave4-plan.md, item 8). The image is one of the post's own photos (`photos` column,
-- uploaded through the photo reservation like any other); `body.quote_card` says which photo it is and which quote
-- it shows, so the Post screen can offer to change or remove it. Adds only.

-- p_entry null clears the card. Otherwise: the entry is the founder's, the quote is one of its quotes word for word
-- (at most 280 characters, the Library's own limit), and the image is already one of the post's photos.
create function public.post_set_quote_card(p_item uuid, p_entry uuid, p_quote text, p_object text default null)
returns jsonb
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_user uuid := public.require_user();
  v_row public.content_items;
  v_entry public.library_entries;
  v_card jsonb;
begin
  select * into v_row from public.content_items where id = p_item and user_id = v_user and department = 'post' for update;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if p_entry is null then
    if v_row.body ? 'quote_card' then
      update public.content_items set body = body - 'quote_card', updated_at = now() where id = p_item;
    end if;
    return null;
  end if;
  if v_row.status not in ('in_review', 'approved') then
    raise exception '%', case when v_row.status = 'published' then 'This post is already posted; its images cannot change.'
      else 'Make a quote card once the post is written.' end using errcode = 'P0001';
  end if;
  select * into v_entry from public.library_entries where opportunity_id = p_entry and user_id = v_user;
  if not found then
    raise exception 'This conversation is not in your Library.' using errcode = 'P0002';
  end if;
  if p_quote is null or char_length(p_quote) not between 1 and 280
     or not exists (select 1 from jsonb_array_elements(v_entry.quotes) q where q->>'text' = p_quote) then
    raise exception 'Pick one of the quotes kept from this conversation.' using errcode = '22023';
  end if;
  if p_object is null or not (p_object = any (v_row.photos)) then
    raise exception 'The quote card image is missing. Make it again.' using errcode = '22023';
  end if;
  v_card := jsonb_build_object('entryId', p_entry, 'quote', p_quote, 'community', v_entry.community,
    'platform', v_entry.platform, 'object', p_object);
  update public.content_items set body = body || jsonb_build_object('quote_card', v_card), updated_at = now()
  where id = p_item;
  return v_card;
end;
$$;
revoke all on function public.post_set_quote_card(uuid, uuid, text, text) from public, anon;
grant execute on function public.post_set_quote_card(uuid, uuid, text, text) to authenticated;

-- A quote card whose image left the post's photos (removed, or replaced) is no longer on the post.
create function public.content_items_quote_card_gone() returns trigger
  language plpgsql
  set search_path to ''
as $$
begin
  if new.body ? 'quote_card' and not (coalesce(new.body->'quote_card'->>'object', '') = any (coalesce(new.photos, '{}'))) then
    new.body := new.body - 'quote_card';
  end if;
  return new;
end;
$$;
revoke all on function public.content_items_quote_card_gone() from public, anon, authenticated;

create trigger content_items_quote_card_gone before update of photos on public.content_items
  for each row execute function public.content_items_quote_card_gone();
