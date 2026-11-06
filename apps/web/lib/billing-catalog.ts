/**
 * What is on sale, from `billing_catalog`: the one source for the prices the pages show, the checkout route charges and
 * the webhook grants. A price test changes rows, never code.
 */
import "server-only";

import { createClient } from "@supabase/supabase-js";

import { PLANS, withCatalogPrice, type Plan } from "./pricing";

export type CatalogRow = {
  creem_product_id: string;
  slug: string;
  kind: "plan" | "pack";
  plan_id: string | null;
  credits: number;
  price_cents: number;
  interval: "month" | "year" | null;
  sort: number;
};

const CACHE_MS = 60_000;
let cached: { at: number; rows: CatalogRow[] } | null = null;

/**
 * Rows on sale. Prices are public (RLS), so this needs no session and works on pages without one. An unreachable database
 * answers an empty list: a page then shows its last known numbers, but nothing can be bought, because checkout reads the
 * table itself.
 */
export async function catalogOnSale(): Promise<CatalogRow[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rows;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  try {
    const { data, error } = await createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      .from("billing_catalog")
      .select("creem_product_id, slug, kind, plan_id, credits, price_cents, interval, sort")
      .order("sort");
    if (error) throw error;
    cached = { at: Date.now(), rows: (data ?? []) as CatalogRow[] };
    return cached.rows;
  } catch {
    console.error("[billing] could not read the catalogue");
    return [];
  }
}

export type SellablePlan = Plan & { slug?: string };

/** The plans with their live prices. `slug` is what checkout takes; a plan without one cannot be bought right now. */
export async function plansOnSale(): Promise<SellablePlan[]> {
  const rows = await catalogOnSale();
  const monthly = rows.find((row) => row.kind === "plan" && row.interval === "month");
  return PLANS.map((plan) => {
    const row = rows.find((candidate) => candidate.kind === "plan" && candidate.plan_id === plan.id);
    if (!row) return plan;
    return { ...withCatalogPrice(plan, row.price_cents, row.credits, monthly?.price_cents), slug: row.slug };
  });
}

export async function packsOnSale(): Promise<CatalogRow[]> {
  return (await catalogOnSale()).filter((row) => row.kind === "pack");
}

/** The numbers the landing page and blog print. */
export async function offerPrices(): Promise<{ monthly: number; annual: number; annualBilled: number }> {
  const plans = await plansOnSale();
  const monthly = plans.find((plan) => plan.id === "starter")!;
  const annual = plans.find((plan) => plan.id === "creator")!;
  return { monthly: monthly.price, annual: annual.price, annualBilled: annual.billedPrice };
}
