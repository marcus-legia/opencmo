import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";

/**
 * The v2 Dashboard on fixtures (U3). Runs only in a build with NEXT_PUBLIC_OPENCMO_UI=v2: `npm run test:e2e:v2`.
 * Approving a card must update every count on screen from the same queue.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

test("approving a card drops every count, logs it, and empties the queue", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app");

  const queue = page.getByTestId("approval-queue");
  const headline = page.getByTestId("dash-headline");
  const badge = page.getByRole("navigation", { name: "Main" }).locator(".v2-rail-count");
  await expect(queue.getByTestId("approval-card")).toHaveCount(5);
  await expect(headline).toHaveText("5 things wait on you.");
  await expect(badge).toHaveText("5");
  const writer = page.getByRole("link", { name: /^Writer, working/ });
  await expect(writer).toContainText("1 waiting on you");

  await queue.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(headline).toHaveText("4 things wait on you.");
  await expect(badge).toHaveText("4");
  await expect(queue.getByTestId("queue-count")).toHaveText("4");
  await expect(writer).toContainText("Nothing waiting");
  await expect(page.getByTestId("live-log").locator("li").first()).toContainText("You approved the X post");

  // The schedule card decides the TikTok row of "Going out today".
  await queue.getByRole("button", { name: /Short 1 to TikTok/ }).click();
  await queue.getByRole("button", { name: "Approve time" }).click();
  await expect(page.getByRole("row", { name: /Edit by asking/ })).toContainText("Scheduled");

  // Dismissing asks for an optional reason before the card leaves.
  await queue.getByRole("button", { name: /r\/SaaS/ }).click();
  await queue.getByRole("button", { name: "Dismiss" }).click();
  await queue.getByLabel(/Why\?/).fill("Not my audience");
  await queue.locator(".v2-card-decline").getByRole("button", { name: "Dismiss" }).click();
  await expect(headline).toHaveText("2 things wait on you.");

  while ((await queue.getByTestId("approval-card").count()) > 0) {
    await queue.locator(".v2-card[data-open] .v2-button.is-primary").first().click();
  }
  await expect(headline).toHaveText("Nothing waits on you.");
  await expect(queue).toContainText("Nothing waits on you.");
  await expect(badge).toHaveCount(0);
});

test("the phone shows the team list, the tab bar count and one card per page", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  await expect(page.getByRole("region", { name: "Your team" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Main" }).filter({ hasText: "Today" });
  await expect(tabs.getByRole("link", { name: "Approve · 5" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await tabs.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Library" })).toBeVisible();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Close" }).click();

  await page.goto("/app/inbox/sample-reply");
  await expect(page.getByTestId("inbox-card-page").getByTestId("approval-card")).toContainText("r/SaaS");
  await page.goto("/app/inbox/not-a-card");
  await expect(page.getByText("This card is no longer waiting.")).toBeVisible();
});
