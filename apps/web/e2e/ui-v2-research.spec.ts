import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * Research (wave 3, C5): competitors added by website (read with the site reader; a `.test` host is its e2e fake),
 * shown with their site, price, offer and this week's mentions; the left panel lists them; Remove asks first.
 * Screenshots: `test-results/research-*.png`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

test("add a competitor by website, see it in Research and the left panel, remove it", async ({ page }) => {
  test.setTimeout(120_000);
  const { url, service } = state();
  const db = createClient(url, service, { auth: { persistSession: false } });
  const email = `e2e-research-${randomUUID()}@test.local`;
  const password = `pw-${randomUUID()}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const userId = created.data.user!.id;
  expect((await db.from("marketing_documents").insert({ user_id: userId, ...ONBOARDING_DOCUMENT })).error).toBeNull();

  await signIn(page, { email, password, id: userId });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/research");
  await expect(page.getByRole("heading", { level: 1, name: "Competitors" })).toBeVisible();
  await expect(page.getByTestId("research-empty")).toBeVisible();

  await page.getByLabel("Add one").fill("chaser.test");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const card = page.getByTestId("research-competitor");
  await expect(card).toHaveCount(1);
  // The fake site's title is "chaser: invoicing that chases late payments"; its price line says "$12 a month".
  await expect(card).toContainText("chaser");
  await expect(card).toContainText("chaser.test");
  await expect(card).toContainText("$12 a month");
  await expect(card).toContainText("Invoicing for freelancers that sends the reminders for you");
  await expect(card).toContainText("0 this week");
  const { data: row } = await db.from("competitors").select("site, added_via").eq("user_id", userId).single();
  expect(row).toEqual({ site: "chaser.test", added_via: "url" });

  // A mention in a Sales conversation this week counts.
  const opp = await db.from("opportunities").insert({ user_id: userId, url: "https://www.reddit.com/r/SaaS/comments/e2emention/x/", platform: "reddit", community: "SaaS", title: "Is chaser worth it?", snippet: "I tried chaser.test last month", score: 60, posted_at: new Date().toISOString() });
  expect(opp.error).toBeNull();
  await page.reload();
  await expect(card).toContainText("1 this week");
  await expect(page.getByTestId("context-competitors")).toContainText("chaser");
  await page.screenshot({ path: "test-results/research-1440.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/research-390.png", fullPage: true });

  page.once("dialog", (dialog) => void dialog.accept());
  await card.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("research-empty")).toBeVisible();
  const { count } = await db.from("competitors").select("id", { count: "exact", head: true }).eq("user_id", userId);
  expect(count).toBe(0);
});
