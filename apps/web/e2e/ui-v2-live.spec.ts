import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * CMO chat live (docs/plans/cmo/2026-11-02-cmo-chat-live-plan.md): a task handed out from the chat says so in the chat
 * when it finishes and opens its screen, and a rating survives a reload. Fake model (`OPENCMO_AGENT_FAKE=1`). Runs with
 * `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-11-02-cmo-chat-live-shots");

test("a finished draft comes back to the chat and lands on the feed; Open goes to Writer; a rating is kept", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  await signIn(page, state().users.b);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  const chat = page.locator("#v2-chat");
  await chat.getByLabel("Ask your CMO").fill("Draft a post for X about the launch");
  await chat.getByLabel("Ask your CMO").press("Enter");

  const line = chat.getByTestId("run-line");
  await expect(line).toContainText("Draft ready to review", { timeout: 120_000 });
  // On the feed the founder stays on the feed: the draft's card arrives in the list, and its row in "This week".
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("approval-queue").locator('[data-testid="feed-row"][data-card-id]').first()).toBeVisible();
  // The run line's Open is the way to Writer: there the chat is a drawer, and it stays open.
  await line.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/app\/writer/);
  await expect(chat.getByLabel("Ask your CMO")).toBeVisible();
  await page.screenshot({ path: join(OUT, "run-line-1440.png") });

  const up = chat.getByRole("button", { name: "Good answer" }).last();
  // The button turns at once; the rating is saved by its own request, which a reload must not cut short.
  const saved = page.waitForResponse((r) => r.url().includes("/ratings") && r.request().method() === "POST");
  await up.click();
  await expect(up).toHaveAttribute("aria-pressed", "true");
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await page.getByRole("banner").getByRole("button", { name: "Chat" }).click();
  await expect(chat.getByTestId("run-line")).toContainText("Draft ready to review");
  await expect(chat.getByRole("button", { name: "Good answer" }).last()).toHaveAttribute("aria-pressed", "true");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chat.getByTestId("run-line")).toBeVisible();
  await page.screenshot({ path: join(OUT, "run-line-390.png") });
});
