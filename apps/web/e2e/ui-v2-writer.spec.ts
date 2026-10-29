import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * P3 Writer for every platform (sessions/C.md). C0: the Threads and LinkedIn post cards and the captions on the
 * Studio cards, on fixtures, at 1440 and 390 with axe. v2 build only: `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-10-28-p3-acceptance", "c");

async function axeAndShot(page: Page, name: string, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: join(OUT, `${name}-${width}.png`), fullPage: true });
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Sample cards (`SAMPLE_CARDS`), opened the way the digest links to them; the caption editors are opened too. */
const CARDS: { name: string; id: string; open?: string }[] = [
  { name: "card-threads", id: "card-post-threads" },
  { name: "card-linkedin", id: "card-post-linkedin" },
  { name: "card-shorts-captions", id: "card-shorts", open: "Edit TikTok caption" },
  { name: "card-finished-captions", id: "card-finished", open: "Edit YouTube title and description" },
  { name: "card-correction", id: "card-correction" },
];

for (const sample of CARDS) {
  test(`${sample.name}: no serious axe violation at 1440 and 390, editor open too`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await signIn(page, state().users.a);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      await page.goto(`/app/inbox/${sample.id}`);
      await expect(page.getByTestId("inbox-card-page").getByTestId("approval-card")).toBeVisible();
      await axeAndShot(page, sample.name, width);
      if (sample.open) {
        await page.getByRole("button", { name: sample.open }).first().click();
        await axeAndShot(page, `${sample.name}-editing`, width);
      }
    }
  });
}

test("LinkedIn shows where “more” cuts the post; Threads and LinkedIn approve and open their composer", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.goto("/app/inbox/card-post-linkedin");
  const card = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  await expect(card).toContainText("The first 140 characters show before “more” on a phone.");
  await expect(card.locator(".v2-card-fold")).toHaveCount(1);
  await expect(card).toContainText("/3000");
  await expect(card.getByRole("button", { name: "Approve, copy and open LinkedIn" })).toBeVisible();

  await page.goto("/app/inbox/card-post-threads");
  const threads = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  await expect(threads).toContainText("/500");
  await expect(threads.locator(".v2-card-fold")).toHaveCount(0);
  // The composer is never really reached from a test: the tab's address is what the founder would land on.
  await page.context().route("https://www.threads.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Threads</title>" }));
  const popup = page.waitForEvent("popup");
  await threads.getByRole("button", { name: "Approve and open Threads" }).click();
  const tab = await popup;
  await expect.poll(() => tab.url()).toContain("threads.com/intent/post?text=I%20spent%20more%20time");
  await tab.close();
});

test("a caption counts its limit and hashtags per platform; too many hashtags cannot be saved", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.goto("/app/inbox/card-shorts");
  const card = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  const tiktok = card.getByTestId("caption").filter({ hasText: "TikTok caption" }).first();
  await expect(tiktok).toContainText("#2/5");
  await tiktok.getByRole("button", { name: "Edit TikTok caption" }).click();
  await tiktok.getByLabel("Caption").fill("Cut by words #a1 #b #c #d #e #f");
  await expect(tiktok).toContainText("At most 5 hashtags here.");
  await expect(tiktok.getByRole("button", { name: "Save caption" })).toBeDisabled();
  await tiktok.getByLabel("Caption").fill("Cut your demo by deleting words. #editing");
  await tiktok.getByRole("button", { name: "Save caption" }).click();
  await expect(tiktok).toContainText("Cut your demo by deleting words. #editing");
  await expect(tiktok).toContainText("#1/5");
});
