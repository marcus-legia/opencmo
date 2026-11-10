import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";

/**
 * Setup shows its work (CMO review 3, 3.2), with the fake model (`OPENCMO_AGENT_FAKE=1`/`OPENCMO_AI_FAKE=1`) and a
 * `.test` website. The steps appear in order, the answers are saved, Skip hides the questions, and the end goes to
 * the Dashboard. Screenshots at 1280 px and 390 px: `test-results/setup-*.png`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

async function newFounder() {
  const email = `e2e-setup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const password = "e2e-setup-password";
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create the founder: ${error?.message}`);
  return { email, password, id: data.user.id };
}

for (const width of [1280, 390]) {
  test(`at ${width} px: the steps in order, the answers saved, then the Dashboard`, async ({ page }) => {
    test.setTimeout(240_000);
    const user = await newFounder();
    await signIn(page, user);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/app/setup?site=paylane.test");
    await page.getByRole("button", { name: "Read my website" }).click();

    const progress = page.getByTestId("setup-progress");
    await expect(progress).toBeVisible();
    const steps = progress.getByTestId("setup-step");
    await expect(steps).toHaveCount(7);
    await expect(steps.first()).toContainText("Reading your website");
    await page.screenshot({ path: `test-results/setup-${width}.png` });

    // Answer while it works: the handle, LinkedIn as well as X, and where they heard of us.
    const questions = page.getByTestId("setup-questions");
    await questions.getByLabel("Your X handle").fill("@paylane_hq");
    await questions.getByLabel("X", { exact: true }).check();
    await questions.getByLabel("LinkedIn").check();
    await questions.getByLabel("How did you hear about OpenCMO?").selectOption("reddit");
    await questions.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("setup-questions-saved")).toBeVisible();
    const { data: profile } = await admin().from("profiles").select("x_handle, post_platforms, heard_from").eq("id", user.id).single();
    expect(profile).toEqual({ x_handle: "paylane_hq", post_platforms: ["linkedin", "x"], heard_from: "reddit" });

    // The documents are written one by one: each step ends before the next.
    await expect(steps.nth(4)).toHaveAttribute("data-state", "done", { timeout: 120_000 });
    const states = await steps.evaluateAll((items) => items.slice(0, 5).map((item) => item.getAttribute("data-state")));
    expect(states).toEqual(["done", "done", "done", "done", "done"]);

    await expect(page).toHaveURL(/\/app$/, { timeout: 180_000 });
    // The answers reached the content plan the planner reads.
    const { data: plan } = await admin().from("marketing_documents_latest").select("body").eq("user_id", user.id).eq("kind", "content_strategy").single();
    expect(String((plan!.body as { cadence?: string }).cadence)).toMatch(/^The founder posts on X, LinkedIn\./);
    // Today opens with the strategy to read.
    await expect(page.getByTestId("today").getByTestId("today-row").filter({ hasText: "Ready to read: your marketing strategy" })).toBeVisible();
  });
}

test("Skip hides the questions and saves nothing", async ({ page }) => {
  test.setTimeout(240_000);
  const user = await newFounder();
  await signIn(page, user);
  await page.goto("/app/setup?site=paylane.test");
  await page.getByRole("button", { name: "Read my website" }).click();
  await page.getByTestId("setup-questions").getByRole("button", { name: "Skip" }).click();
  await expect(page.getByTestId("setup-questions")).toHaveCount(0);
  const { data: profile } = await admin().from("profiles").select("x_handle, post_platforms, heard_from").eq("id", user.id).single();
  expect(profile).toEqual({ x_handle: null, post_platforms: null, heard_from: null });
  await expect(page).toHaveURL(/\/app$/, { timeout: 180_000 });
});
