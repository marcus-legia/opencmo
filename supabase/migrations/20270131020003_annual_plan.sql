-- Wave 2 A5 (docs/plans/cmo/2026-11-19-wave2-plan.md): the annual plan, $690 a year.
--
-- Live and test Creem product ids differ, so no migration can hold the row itself (`scripts/creem-catalog.mjs` fills
-- the test store). Once the owner has created the live product in Creem, they run, in the SQL editor:
--
--     select public.billing_catalog_put_annual('prod_…');
--
-- The row grants the monthly plan's credits each month (`grant_annual_credits`), so its allowance on the fair-use bar
-- is the same as the monthly plan's. A different annual product already on sale is taken off sale, never deleted:
-- founders who hold it keep their renewals and credits, because the webhook looks products up by id.
create function public.billing_catalog_put_annual(p_product_id text, p_price_cents integer default 69000)
returns public.billing_catalog
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_row public.billing_catalog;
  v_credits integer;
begin
  if p_product_id is null or p_product_id !~ '^prod_[A-Za-z0-9]{4,64}$' then
    raise exception 'Give the Creem product id (prod_…).' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents < 100 or p_price_cents > 1000000 then
    raise exception 'The price is in cents, between 100 and 1,000,000.' using errcode = '22023';
  end if;
  select * into v_row from public.billing_catalog where creem_product_id = p_product_id;
  if found then
    if v_row.kind <> 'plan' or v_row."interval" <> 'year' or v_row.price_cents <> p_price_cents then
      raise exception 'That product is already listed as something else. A price change needs a new Creem product.'
        using errcode = '22023';
    end if;
    update public.billing_catalog set on_sale = true where creem_product_id = p_product_id returning * into v_row;
    return v_row;
  end if;

  select c.credits into v_credits from public.billing_catalog c
  where c.kind = 'plan' and c."interval" = 'month' and c.on_sale
  order by c.sort limit 1;
  if v_credits is null then
    raise exception 'List the monthly plan first: the annual plan grants the same credits each month.' using errcode = '55000';
  end if;

  update public.billing_catalog
  set on_sale = false, slug = left('annual-' || creem_product_id, 100)
  where kind = 'plan' and "interval" = 'year' and slug = 'annual';

  insert into public.billing_catalog (creem_product_id, slug, kind, plan_id, credits, price_cents, "interval", on_sale, sort)
  values (p_product_id, 'annual', 'plan', 'creator', v_credits, p_price_cents, 'year', true, 20)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.billing_catalog_put_annual(text, integer) from public, anon, authenticated;
grant execute on function public.billing_catalog_put_annual(text, integer) to service_role;
