import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import type { E2EUser } from "./global-setup";
import { sidewaysOverflow, signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * The fair-use bar (wave 2, plan 2026-11-19 §1): the top bar shows the plan and the share of this month's allowance
 * used, never a balance; Billing shows the bar and the reset date; at 100% Sales says new scans wait for the reset.
 * The numbers come from `plan_usage()`; the pause itself is `cmo_enqueue`'s (pgTAP 329).
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-11-19-wave2-shots");

function admin() {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
}

/** A founder past Setup, on the free plan. */
async function founder(): Promise<E2EUser> {
  const db = admin();
  const user: E2EUser = { email: `usage-${randomUUID()}@test.local`, password: `pw-${randomUUID()}`, id: "" };
  const created = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  if (created.error) throw new Error(`Could not create a founder: ${created.error.message}`);
  user.id = created.data.user!.id;
  const doc = await db.from("marketing_documents").insert({ user_id: user.id, ...ONBOARDING_DOCUMENT });
  if (doc.error) throw new Error(`Could not seed a document: ${doc.error.message}`);
  return user;
}

const must = (r: { error: { message: string } | null }, what: string) => {
  if (r.error) throw new Error(`Could not seed ${what}: ${r.error.message}`);
};

/** A Pro founder whose monthly product gives `allowance` credits, with `used` of them spent on work this month. */
async function proFounder(allowance: number, used: number): Promise<E2EUser> {
  const db = admin();
  const user = await founder();
  const product = `prod_e2e_${user.id.slice(0, 8)}`;
  // Off sale: the row gives this founder's subscription its allowance without showing up on anyone's plan list.
  must(await db.from("billing_catalog").insert({ creem_product_id: product, slug: `e2e-${user.id.slice(0, 8)}`, kind: "plan", plan_id: "starter", credits: allowance, price_cents: 6900, interval: "month", on_sale: false }), "the product");
  must(await db.from("profiles").update({ plan: "starter", timezone: "UTC", credit_balance: allowance * 2 }).eq("id", user.id), "the plan");
  const now = new Date();
  must(
    await db.from("creem_subscriptions").insert({
      subscription_id: `sub_e2e_${user.id}`,
      customer_id: `cus_e2e_${user.id}`,
      user_id: user.id,
      product_id: product,
      plan: "starter",
      interval: "month",
      status: "active",
      current_period_end: new Date(now.getTime() + 12 * 86_400_000).toISOString(),
      provider_event_at: now.toISOString(),
      status_priority: 1,
      event_id: `evt_e2e_${user.id}`,
    }),
    "the subscription",
  );
  if (used > 0) {
    must(await db.from("credit_ledger").insert({ user_id: user.id, delta: -used, reason: "e2e: a month of scans", ref_kind: "cmo_run", ref_id: randomUUID() }), "the usage");
  }
  return user;
}

test("a paid founder sees Pro and the share used, Billing shows the bar and the reset, no balance", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const user = await proFounder(200, 120);
  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/sales");
  const chip = page.getByRole("banner").getByTestId("usage-chip");
  await expect(chip).toHaveText(/Pro · 60% used/);
  await expect(page.getByTestId("sales-paused")).toHaveCount(0);
  // Included work shows no price per click (wave 2 C2): the scan's button and its confirm card name no credits.
  const scan = page.getByTestId("v2-sales").getByRole("button", { name: "Scan now", exact: true });
  await scan.click();
  const confirm = page.getByRole("group", { name: "Scan now" });
  await expect(confirm.getByRole("button", { name: "Start the scan" })).toBeVisible();
  await expect(confirm).not.toContainText("credit");
  await confirm.getByRole("button", { name: "Cancel" }).click();

  await chip.click();
  await expect(page).toHaveURL(/\/app\/billing/);
  const usage = page.getByTestId("billing-usage");
  await expect(usage.getByRole("meter", { name: "Fair-use allowance used" })).toHaveAttribute("aria-valuenow", "60");
  await expect(usage).toContainText(/Resets on \d{1,2} \w{3}\./);
  await expect(page.getByTestId("billing-plan")).not.toContainText("Credits left");
  await expect(page.getByTestId("billing-plan")).toContainText(/renews on \d{1,2} \w{3}/);
  await page.screenshot({ path: join(OUT, "billing-1440.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(usage).toBeVisible();
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `billing @ 390: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await page.screenshot({ path: join(OUT, "billing-390.png"), fullPage: true });
});

test("at 100% the chip and Sales say new scans wait for the reset", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const user = await proFounder(100, 100);
  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/sales");
  await expect(page.getByRole("banner").getByTestId("usage-chip")).toHaveText(/Pro · 100% used/);
  const banner = page.getByTestId("sales-paused");
  await expect(banner).toContainText("You used this month's allowance");
  await expect(banner).toContainText(/New scans start again on \d{1,2} \w{3}\./);
  await expect(page.getByTestId("v2-sales").getByRole("button", { name: "Scan now", exact: true })).toBeDisabled();
  await page.screenshot({ path: join(OUT, "sales-paused-1440.png") });

  await page.goto("/app/billing");
  await expect(page.getByTestId("billing-usage")).toContainText(/New scans pause until \d{1,2} \w{3}\./);
});

test("a free founder's chip leads to the plans", async ({ page }) => {
  await signIn(page, await founder());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/sales");
  const chip = page.getByRole("banner").getByTestId("usage-chip");
  await expect(chip).toHaveText(/Free · See plans/);
  await chip.click();
  await expect(page).toHaveURL(/\/app\/billing/);
  await expect(page.getByTestId("billing-usage")).toHaveCount(0);
});
