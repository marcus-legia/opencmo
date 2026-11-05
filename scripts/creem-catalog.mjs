#!/usr/bin/env node
/**
 * Fills the billing catalogue of the local stack from Creem's TEST store: creates the products that are missing, then
 * writes their ids into `billing_catalog`.
 *
 * Test and live product ids differ, so no migration can hold them. This script only ever touches test data: it uses
 * the Creem CLI's stored login, refuses anything but a test key, and refuses a database that is not on this machine
 * (`apps/web/.env.local` in the main checkout points at production, so it reads `supabase status`, never that file).
 *
 *   node scripts/creem-catalog.mjs                  # products + catalogue
 *   node scripts/creem-catalog.mjs --products-only  # products only, no database needed
 */
import { execFileSync } from "node:child_process";

const CREDITS_PER_MONTH = 580;

/** `slug` is what the checkout route accepts from a client. Prices are in cents. */
const CATALOG = [
  { slug: "monthly", name: "OpenCMO Monthly", kind: "plan", plan_id: "starter", interval: "month", billing_type: "recurring", billing_period: "every-month", price_cents: 6900, credits: CREDITS_PER_MONTH, sort: 10 },
  { slug: "annual", name: "OpenCMO Annual", kind: "plan", plan_id: "creator", interval: "year", billing_type: "recurring", billing_period: "every-year", price_cents: 69000, credits: CREDITS_PER_MONTH, sort: 20 },
  { slug: "credits-200", name: "OpenCMO 200 credits", kind: "pack", plan_id: null, interval: null, billing_type: "onetime", billing_period: "once", price_cents: 2500, credits: 200, sort: 30 },
  { slug: "credits-400", name: "OpenCMO 400 credits", kind: "pack", plan_id: null, interval: null, billing_type: "onetime", billing_period: "once", price_cents: 5000, credits: 400, sort: 40 },
];

const die = (message) => {
  console.error(`creem-catalog: ${message}`);
  process.exit(1);
};

const creem = (...args) => JSON.parse(execFileSync("creem", [...args, "--environment", "test", "--json"], { encoding: "utf8" }));

function ensureProduct(item, existing) {
  const found = existing.find((product) => product.name === item.name && product.status !== "archived");
  if (found) {
    if (found.price !== item.price_cents) die(`${item.name} costs ${found.price} on Creem, expected ${item.price_cents}. A price change needs a new product.`);
    return found.id;
  }
  // The whole body through --data: with CLI 0.9.0 the same recurring product sent as flags was refused for a missing
  // billing period. A one-time product must leave the period out; "once" gets that same misleading refusal.
  const created = creem(
    "products", "create",
    "--idempotency-key", `opencmo-test-${item.slug}`,
    "--data", JSON.stringify({
      name: item.name,
      description: item.kind === "plan" ? `${item.credits} credits per month` : `${item.credits} credits, one time`,
      price: item.price_cents,
      currency: "USD",
      billingType: item.billing_type,
      ...(item.billing_type === "recurring" ? { billingPeriod: item.billing_period } : {}),
      taxMode: "exclusive",
      taxCategory: "saas",
    }),
  );
  console.log(`created ${item.name}`);
  return created.id;
}

async function writeCatalog(rows) {
  const status = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
  const env = Object.fromEntries(status.split("\n").filter((line) => line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
  }));
  const host = new URL(env.API_URL ?? "http://invalid").hostname;
  if (host !== "127.0.0.1" && host !== "localhost") die(`refusing a database that is not local: ${host}`);
  const response = await fetch(`${env.API_URL}/rest/v1/billing_catalog?on_conflict=creem_product_id`, {
    method: "POST",
    headers: {
      apikey: env.SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) die(`could not write billing_catalog: ${response.status} ${await response.text()}`);
}

const login = creem("whoami");
if (!login.authenticated || login.environment !== "test" || !login.api_url?.includes("test-api")) {
  die("log the Creem CLI in with a test key first: creem login --api-key creem_test_...");
}

const existing = creem("products", "list", "--all").items ?? [];
const rows = CATALOG.map(({ name, billing_type, billing_period, ...row }) => ({
  ...row,
  creem_product_id: ensureProduct({ name, billing_type, billing_period, ...row }, existing),
  on_sale: true,
}));

if (!process.argv.includes("--products-only")) await writeCatalog(rows);
console.table(rows.map(({ slug, creem_product_id, price_cents, credits }) => ({ slug, creem_product_id, price_cents, credits })));
