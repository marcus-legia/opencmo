import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * The Context drawer edits a document where the founder is (plan 2026-11-10-today-in-place §3.1): no jump to Library.
 * Edit opens the form in the drawer, Save writes a new version, Escape leaves the form before the drawer.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

test("a document is edited in the drawer over the feed and saved as a new version", async ({ page }) => {
  const { url, service, users } = state();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const user = users.a;
  const version = async () =>
    (await admin.from("marketing_documents").select("version").eq("user_id", user.id).eq("kind", "product").order("version", { ascending: false }).limit(1).single()).data?.version ?? 0;
  const before = await version();

  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await page.getByRole("complementary", { name: "Context" }).getByRole("button", { name: /^Product/ }).click();
  await expect(page).toHaveURL(/\/app\?doc=product$/);
  const drawer = page.getByRole("dialog", { name: "Product" });
  await expect(drawer).toBeVisible();

  // Escape leaves the form first, keeping the drawer open.
  await drawer.getByRole("button", { name: "Edit" }).click();
  await expect(drawer.getByLabel("Name")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer.getByLabel("Name")).toHaveCount(0);
  await expect(drawer).toBeVisible();

  await drawer.getByRole("button", { name: "Edit" }).click();
  await drawer.getByLabel("Name").fill("OpenCMO, edited in place");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer).toContainText("OpenCMO, edited in place");
  await expect(page).toHaveURL(/\/app\?doc=product$/);
  await expect.poll(version).toBe(before + 1);

  // A link with `edit=1` opens the form directly (Research's "Add a competitor", Today's rows).
  await page.goto("/app?doc=competitors&edit=1");
  await expect(page.getByRole("dialog", { name: "Competitors" }).getByRole("button", { name: "Save" })).toBeVisible();
});
