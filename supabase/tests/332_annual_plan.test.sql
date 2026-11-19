-- Wave 2 A5 (20270131020003): the owner lists the $690 annual plan with its Creem product id; it grants the monthly
-- plan's credits; a replaced annual product goes off sale and is kept; users cannot call it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

select ok(not has_function_privilege('authenticated', 'public.billing_catalog_put_annual(text,integer)', 'execute'),
  'users cannot list products');
select throws_ok($$ select public.billing_catalog_put_annual('prod_332year') $$, '55000', null, 'the monthly plan comes first');

insert into public.billing_catalog (creem_product_id, slug, kind, plan_id, credits, price_cents, interval, sort) values
  ('prod_332month', 'test-332-month', 'plan', 'starter', 580, 6900, 'month', 10);
select throws_ok($$ select public.billing_catalog_put_annual('not a product') $$, '22023', null, 'a product id is checked');

select is((select row(slug, plan_id, credits, price_cents, "interval", on_sale)::text from public.billing_catalog_put_annual('prod_332year')),
  row('annual', 'creator', 580, 69000, 'year', true)::text, '$690 a year, the monthly credits each month');
select is((select slug from public.billing_catalog_put_annual('prod_332year')), 'annual', 'running it again changes nothing');
select throws_ok($$ select public.billing_catalog_put_annual('prod_332year', 59000) $$, '22023', null,
  'a new price needs a new product');

-- A price test: a new annual product replaces the old one on sale.
select is((select price_cents from public.billing_catalog_put_annual('prod_332yearB', 59000)), 59000, 'the new product is on sale');
select is((select row(slug, on_sale)::text from public.billing_catalog where creem_product_id = 'prod_332year'),
  row('annual-prod_332year', false)::text, 'the old one is kept, off sale');
select is((select count(*)::int from public.billing_catalog where slug = 'annual' and on_sale), 1, 'one annual plan on sale');

select * from finish();
rollback;
