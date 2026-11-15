-- Lighthouse CI only (.github/workflows/lighthouse.yml): a catalogue so the landing page draws its pricing section,
-- as it does in production. Made-up products and prices, on a throwaway local database; real prices live in the
-- production catalogue, never in the repo.
insert into public.billing_catalog (creem_product_id, slug, kind, plan_id, credits, price_cents, interval, sort) values
  ('lhci_starter_month', 'lhci-starter-month', 'plan', 'starter', 100, 1000, 'month', 1),
  ('lhci_creator_month', 'lhci-creator-month', 'plan', 'creator', 300, 2500, 'month', 2),
  ('lhci_starter_year', 'lhci-starter-year', 'plan', 'starter', 100, 9600, 'year', 3),
  ('lhci_creator_year', 'lhci-creator-year', 'plan', 'creator', 300, 24000, 'year', 4);
insert into public.billing_catalog (creem_product_id, slug, kind, credits, price_cents, sort) values
  ('lhci_pack_small', 'lhci-pack-small', 'pack', 100, 1500, 5);
