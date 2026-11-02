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

test("a finished draft comes back to the chat and opens Writer; a rating is kept", async ({ page }) => {
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
  await expect(page).toHaveURL(/\/app\/writer/);
  await page.screenshot({ path: join(OUT, "run-line-1440.png") });

  const up = chat.getByRole("button", { name: "Good answer" }).last();
  await up.click();
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(chat.getByTestId("run-line")).toContainText("Draft ready to review");
  await expect(chat.getByRole("button", { name: "Good answer" }).last()).toHaveAttribute("aria-pressed", "true");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(chat.getByTestId("run-line")).toBeVisible();
  await page.screenshot({ path: join(OUT, "run-line-390.png") });
});
