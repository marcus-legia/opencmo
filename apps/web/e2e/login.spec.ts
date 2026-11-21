import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";

/**
 * Google is the only sign-in (2026-10-09). E2E never reaches Google: it intercepts Supabase's `/auth/v1/authorize`
 * request and checks it asks for the right provider and the right way back (the callback keeps `next`, the website
 * typed on the landing and the first touch). Trading the `code` for a session at `/auth/callback` is unchanged; its
 * error branches are checked here.
 */
test("the Google button asks OAuth for the right callback", async ({ page }) => {
  let authorize: URL | null = null;
  await page.route(/\/auth\/v1\/authorize/, async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>google</p>" });
  });

  await page.goto("/login?site=https%3A%2F%2Fwww.acme.example%2Fpricing&ref=PH");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  // The website comes back as a host, in the heading and the line under it.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("acme.example");
  await expect(page.getByTestId("login-site")).toHaveText("We'll scan acme.example after you sign in.");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => authorize?.searchParams.get("provider")).toBe("google");
  const back = new URL(authorize!.searchParams.get("redirect_to")!);
  expect(back.pathname).toBe("/auth/callback");
  expect(back.searchParams.get("next")).toBe("/app");
  expect(back.searchParams.get("site")).toBe("https://www.acme.example/pricing");
  // `?ref=PH` on /login is the first touch: kept in the cookie and passed along, cleaned.
  expect(new URLSearchParams(back.searchParams.get("ft")!).get("ref")).toBe("ph");
});

test("login: landing design, no horizontal scroll at 390px, legal links", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("already asking");
  await expect(page.getByText("Free scan. No card.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", /\/privacy$/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("login-390.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: testInfo.outputPath("login-390-dark.png"), fullPage: true });
});

test("callback: cancelled at Google or no code goes back to /login with a sentence", async ({ page }) => {
  await page.goto("/auth/callback?error=access_denied&error_description=cancelled");
  await expect(page).toHaveURL(/\/login\?error=cancelled/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Sign-in was cancelled.");

  await page.goto("/auth/callback");
  await expect(page).toHaveURL(/\/login\?error=no-code/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Google did not finish");
});

test("a free account sees its deletion date in the app", async ({ page }, testInfo) => {
  await signIn(page, state().users.a);
  await page.goto("/app/settings");
  const banner = page.getByTestId("retention-banner");
  await expect(banner).toContainText("Free accounts are deleted 30 days after sign-up");
  await expect(banner).toContainText("days left");
  await expect(banner.getByRole("link", { name: "See plans" })).toHaveAttribute("href", /billing/);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("retention-390.png") });
});
