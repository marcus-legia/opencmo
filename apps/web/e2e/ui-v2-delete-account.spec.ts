import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import type { E2EUser } from "./global-setup";
import { sidewaysOverflow, signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * Delete my account (wave 4 C3): Settings › Account asks for the email typed back; a founder whose plan still renews is
 * refused with a link to Billing (`account_delete`, pgTAP 348); a free founder is deleted, signed out, and the landing
 * page says so in one line. The sign-in itself is gone afterwards. Screenshots: `test-results/delete-account-*.png`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

const must = (r: { error: { message: string } | null }, what: string) => {
  if (r.error) throw new Error(`Could not seed ${what}: ${r.error.message}`);
};

async function founder(paid: boolean): Promise<E2EUser> {
  const db = admin();
  const user: E2EUser = { email: `delete-${randomUUID()}@test.local`, password: `pw-${randomUUID()}`, id: "" };
  const created = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  user.id = created.data.user!.id;
  must(await db.from("marketing_documents").insert({ user_id: user.id, ...ONBOARDING_DOCUMENT }), "a document");
  if (paid) {
    const product = `prod_e2e_del_${user.id.slice(0, 8)}`;
    must(await db.from("billing_catalog").insert({ creem_product_id: product, slug: `e2e-del-${user.id.slice(0, 8)}`, kind: "plan", plan_id: "starter", credits: 200, price_cents: 6900, interval: "month", on_sale: false }), "the product");
    must(await db.from("profiles").update({ plan: "starter", timezone: "UTC" }).eq("id", user.id), "the plan");
    const now = new Date();
    must(
      await db.from("creem_subscriptions").insert({
        subscription_id: `sub_e2e_del_${user.id}`,
        customer_id: `cus_e2e_del_${user.id}`,
        user_id: user.id,
        product_id: product,
        plan: "starter",
        interval: "month",
        status: "active",
        current_period_end: new Date(now.getTime() + 12 * 86_400_000).toISOString(),
        provider_event_at: now.toISOString(),
        status_priority: 1,
        event_id: `evt_e2e_del_${user.id}`,
      }),
      "the subscription",
    );
  }
  return user;
}

async function openDelete(page: import("@playwright/test").Page) {
  await page.goto("/app/settings");
  const card = page.getByTestId("settings-delete-account");
  await expect(card).toContainText("support@ferreto.io");
  await card.getByRole("button", { name: "Delete my account" }).click();
  return card;
}

test("a plan that still renews is refused, with the way to Billing", async ({ page }) => {
  const user = await founder(true);
  await signIn(page, user);
  await page.setViewportSize({ width: 390, height: 844 });
  const card = await openDelete(page);
  const confirm = card.getByRole("button", { name: "Delete my account" });
  // A wrong address never reaches the server.
  await card.getByLabel(/to confirm/).fill("someone-else@test.local");
  await expect(confirm).toBeDisabled();
  await card.getByLabel(/to confirm/).fill(user.email);
  await confirm.click();
  const refusal = card.getByRole("alert");
  await expect(refusal).toContainText("Cancel your plan first, on the Billing page.");
  await expect(refusal.getByRole("link", { name: "Open Billing" })).toHaveAttribute("href", "/app/billing");
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await card.screenshot({ path: "test-results/delete-account-refused-390.png" });
  // Nothing was deleted.
  const { data } = await admin().auth.admin.getUserById(user.id);
  expect(data.user?.id).toBe(user.id);
});

test("a free account deletes itself: signed out, the landing page says so, the sign-in is gone", async ({ page }) => {
  const user = await founder(false);
  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const card = await openDelete(page);
  await card.getByLabel(/to confirm/).fill(user.email.toUpperCase());
  await card.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("account-deleted")).toHaveText("Your account is deleted. Thank you for trying Ferreto.");
  await page.screenshot({ path: "test-results/delete-account-landing-1440.png" });

  const db = admin();
  const { data } = await db.auth.admin.getUserById(user.id);
  expect(data.user ?? null).toBeNull();
  const { count } = await db.from("marketing_documents").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  expect(count).toBe(0);
  // The session went with it: the app sends the browser to sign in.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});
