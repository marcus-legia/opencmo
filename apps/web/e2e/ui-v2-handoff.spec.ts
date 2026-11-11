import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * CMO chat → editor handoff (docs/plans/cmo/2026-11-02-cmo-chat-editor-handoff-plan.md): the founder asks the CMO chat
 * for video work; the editor opens on their video in column 3 and its Assistant sends the request once. Fake model
 * (`OPENCMO_AGENT_FAKE=1`). Runs with `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-11-02-cmo-chat-editor-handoff-shots");
const ASK = "Open my latest video in the editor and add captions";

test("video work asked in the CMO chat opens the editor with the request sent once", async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  await signIn(page, state().users.a);
  const created = await page.request.post("/api/v1/editor/new", { data: { aspect: "9:16", name: "Handoff e2e" } });
  expect(created.status(), await created.text()).toBe(200);
  const { clip_id: clipId } = (await created.json()) as { clip_id: string };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  const chat = page.locator("#v2-chat");
  // The Assistant's turn is shown before its request lands; the reload below waits for the server to have it. The CMO
  // chat's own turn answers while the feed is still open, so only a turn answered on the editor counts.
  const sent = page.waitForResponse(
    (r) => /\/agent\/sessions\/[^/]+\/turns$/.test(new URL(r.url()).pathname) && r.request().method() === "POST" && page.url().includes("/app/editor/"),
    { timeout: 180_000 },
  );
  await chat.getByLabel("Ask your CMO").fill(ASK);
  await chat.getByLabel("Ask your CMO").press("Enter");

  // The editor opens on the newest edit, and the request leaves the URL once it is in the Assistant.
  await expect(page).toHaveURL(new RegExp(`/app/editor/${clipId}$`), { timeout: 120_000 });
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 120_000 });
  const assistant = page.getByRole("complementary", { name: "Assistant" });
  await expect(assistant.getByTestId("assistant-turn").first()).toContainText(ASK, { timeout: 60_000 });
  await page.screenshot({ path: join(OUT, "handoff-1440.png") });

  expect((await sent).status()).toBe(200);

  // A reload never sends it again.
  await page.reload();
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 120_000 });
  await expect(assistant.getByTestId("assistant-turn")).toHaveCount(1, { timeout: 30_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(OUT, "handoff-390.png") });
});
