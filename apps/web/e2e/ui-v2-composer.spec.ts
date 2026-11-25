import { expect, test } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * The Composer (plan docs/superpowers/plans/2026-11-25-composer.md, Task C2) on sample data (`?sample=1`): the context
 * API and the `compose_check` job are the data part's, so this spec runs the screen against `lib/composer/sample.ts`.
 * Live checks flag sentences as the founder types; Check costs a credit only after a confirmation; an AI issue's Apply
 * swaps the sentence; the draft survives a reload; nothing posts.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 pages are built only with NEXT_PUBLIC_OPENCMO_UI=v2");
test.beforeAll(ensureOnboarded);

test("Reddit: rules before writing, live flags, a confirmed check, Apply, and the draft kept", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/compose?sample=1&platform=reddit&sub=SaaS");
  await expect(page.getByRole("heading", { level: 1, name: "Composer" })).toBeVisible();

  const before = page.getByTestId("composer-before");
  await expect(before.getByTestId("composer-rules").locator("li")).toHaveCount(3);
  await expect(before.getByTestId("composer-readiness")).toHaveAttribute("data-level", "caution");
  await expect(before.getByTestId("composer-reasons")).toContainText("Comment in r/SaaS");

  await page.getByTestId("composer-title").fill("How do you follow up after a helpful reply?");
  await page.getByTestId("composer-body").fill("Ferreto is a game changer. See ferreto.io for more.");
  const issues = page.getByTestId("composer-issue");
  await expect(issues.filter({ hasText: "Links" })).toHaveCount(1);
  await expect(issues.filter({ hasText: "Product mention" }).first()).toBeVisible();
  await expect(issues.filter({ hasText: "No AI slop" })).toHaveCount(1);
  await expect(page.locator(".cmp-mark").first()).toBeVisible();

  // Charge before running: the button shows the price, then asks once.
  await page.getByTestId("composer-check").click();
  await expect(page.getByTestId("composer-check-cost")).toContainText("1 credit");
  await page.getByTestId("composer-check-start").click();
  const ai = issues.filter({ hasText: "AI check" });
  await expect(ai).toHaveCount(1);
  await ai.getByTestId("composer-apply").click();
  await expect(page.getByTestId("composer-body")).toHaveValue(/^Disclosure: I built a tool for this\. Ferreto is a game changer\./);
  await expect(ai).toHaveCount(0);
  // "I built" says the product is the founder's: the mention is no longer flagged.
  await expect(issues.filter({ hasText: "Product mention" })).toHaveCount(0);

  // Kept on this device per platform and sub.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId("composer-body")).toHaveValue(/^Disclosure: I built a tool/);

  await expect(page.getByTestId("composer-open")).toHaveText("Copy and open r/SaaS");
});

test("X: a draft opened from Posts keeps its words; no title; the platform's length", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/app/compose?sample=1&platform=x&text=${encodeURIComponent("We answered 40 threads this month. Two became customers.")}`);
  await expect(page.getByTestId("composer-body")).toHaveValue("We answered 40 threads this month. Two became customers.");
  await expect(page).not.toHaveURL(/text=/);
  await expect(page.getByTestId("composer-title")).toHaveCount(0);
  await expect(page.getByTestId("composer-issue")).toHaveCount(0);
  await expect(page.getByTestId("composer-count")).toContainText("/4,000 characters");
  await expect(page.getByTestId("composer-open")).toHaveText("Copy and open X");
});

test("the Composer has no sideways scroll at 390 px", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/compose?sample=1&platform=reddit&sub=SaaS");
  await expect(page.getByTestId("composer-rules")).toBeVisible();
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
});
