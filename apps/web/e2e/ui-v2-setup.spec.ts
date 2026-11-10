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
    // One width in each theme (the theme follows the system); the other theme is shot on the website step below.
    const theme = width === 1280 ? "light" : "dark";
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page, user);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/app/setup?site=paylane.test");
    await expect(page.getByRole("heading", { name: "Start with your website." })).toBeVisible();
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Start with your website." })).toBeVisible();
    await page.screenshot({ path: `test-results/setup-${width}-website-${theme === "light" ? "dark" : "light"}.png` });
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await page.getByRole("button", { name: "Read my website" }).click();

    const progress = page.getByTestId("setup-progress");
    await expect(progress).toBeVisible();
    const steps = progress.getByTestId("setup-step");
    await expect(steps).toHaveCount(7);
    await expect(steps.first()).toContainText("Reading your website");
    // The fake model can finish before the first 2 s poll, so the shot may show the list before its first step.
    await page.screenshot({ path: `test-results/setup-${width}-${theme}.png` });

    // Answer while it works: the handle, LinkedIn as well as X, and where they heard of us.
    const questions = page.getByTestId("setup-questions");
    await questions.getByLabel("Your X handle").fill("@paylane_hq");
    await questions.getByRole("checkbox", { name: "X", exact: true }).check();
    await questions.getByRole("checkbox", { name: "LinkedIn" }).check();
    await questions.getByLabel("How did you hear about OpenCMO?").selectOption("reddit");
    await questions.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("setup-questions-saved")).toBeVisible();
    const { data: profile } = await admin().from("profiles").select("x_handle, post_platforms, heard_from").eq("id", user.id).single();
    expect(profile).toEqual({ x_handle: "paylane_hq", post_platforms: ["linkedin", "x"], heard_from: "reddit" });

    await expect(page).toHaveURL(/\/app$/, { timeout: 180_000 });
    // The run wrote its real steps, in order (the fake model is quicker than the 2 s poll, so the list is read back).
    const { data: run } = await admin().from("cmo_runs").select("steps").eq("user_id", user.id).eq("kind", "onboard").single();
    expect(run!.steps).toEqual(["site", "product", "strategy", "competitors", "content_strategy"].map((id) => ({ id, status: "done" })));
    // The answers reached the content plan the planner reads.
    const { data: plan } = await admin().from("marketing_documents_latest").select("body").eq("user_id", user.id).eq("kind", "content_strategy").single();
    expect(String((plan!.body as { cadence?: string }).cadence)).toMatch(/^The founder posts on X, LinkedIn\./);
    // Today opens with the strategy to read.
    await expect(page.getByTestId("approval-queue").getByTestId("feed-row").filter({ hasText: "Ready to read: your marketing strategy" })).toBeVisible();
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
