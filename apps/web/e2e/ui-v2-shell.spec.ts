import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * The Today frame (docs/design/today-canvas, PR #189): no rail and no tab strip. Each screen wears its artboard's top
 * bar; the CMO chat is the feed's right column and a drawer elsewhere, one chat that lives across screens; Logs open
 * over any screen; the editor's Assistant takes the right column. Runs with `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-10-30-three-column-shell-shots");

test("the top bars move between views and agent pages; the chat is a column on the feed and a drawer elsewhere", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app?sample=1");
  const chat = page.locator("#v2-chat");
  await expect(page.getByTestId("v2-dashboard")).toBeVisible();
  await expect(chat.getByLabel("Ask your CMO")).toBeVisible();

  // Feed → Calendar → Analytics through the one bar the three views share.
  const views = page.getByRole("banner").getByRole("navigation", { name: "View" });
  await expect(views.getByRole("link", { name: "Feed" })).toHaveAttribute("aria-current", "page");
  await views.getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/app\/schedule/);
  // One working screen: the chat stays a column beside every view.
  await expect(chat.getByLabel("Ask your CMO")).toBeVisible();
  await expect(views.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  await views.getByRole("link", { name: "Analytics" }).click();
  await expect(page).toHaveURL(/\/app\/analytics/);

  await expect(chat.getByLabel("Ask your CMO")).toBeVisible();

  // Sales is the fourth view of the same bar, and Feed leads back.
  await views.getByRole("link", { name: "Sales" }).click();
  await expect(page).toHaveURL(/\/app\/sales/);
  await expect(page.getByTestId("v2-sales")).toBeVisible();
  await expect(views.getByRole("link", { name: "Sales" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("complementary", { name: "Context" })).toBeVisible();
  await views.getByRole("link", { name: "Feed" }).click();
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.getByTestId("v2-dashboard")).toBeVisible();

  // Logs open over the screen and close again.
  await page.getByRole("banner").getByRole("button", { name: "Logs" }).click();
  const logs = page.getByRole("dialog", { name: "Logs" });
  await expect(logs).toBeVisible();
  await logs.getByRole("button", { name: "Close" }).first().click();
  await expect(logs).toHaveCount(0);

  // Autopilot's switch on the bar (sample settings: on for X): one press and every post waits for Approve.
  const autopilot = page.getByRole("banner").getByTestId("autopilot-switch");
  await expect(autopilot).toHaveAttribute("aria-pressed", "true");
  await autopilot.click();
  await expect(autopilot).toHaveAttribute("aria-pressed", "false");
  await expect(autopilot).toContainText("Autopilot off");
});

test("the feed's Context and chat columns resize by drag and keyboard, and keep their width across a reload", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app?sample=1");
  await expect(page.getByTestId("v2-dashboard")).toBeVisible();
  const width = (selector: string) => page.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().width));

  const chatSash = page.getByRole("separator", { name: "Resize the chat" });
  await expect(chatSash).toHaveAttribute("aria-valuenow", "380");
  await chatSash.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(chatSash).toHaveAttribute("aria-valuenow", "412");
  expect(await width("#v2-chat")).toBe(412);

  const leftSash = page.getByRole("separator", { name: "Resize the context column" });
  const box = (await leftSash.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => width("#td-context")).toBe(348);

  await page.reload();
  await expect(page.getByTestId("v2-dashboard")).toBeVisible();
  expect(await width("#v2-chat")).toBe(412);
  expect(await width("#td-context")).toBe(348);

  // Enter puts a column back to its default.
  await chatSash.focus();
  await page.keyboard.press("Enter");
  await expect(chatSash).toHaveAttribute("aria-valuenow", "380");
  await leftSash.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => width("#td-context")).toBe(288);
});

test("the chat keeps its draft across screens, and ?ask=1 puts the cursor in it", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app?sample=1");
  const chat = page.locator("#v2-chat");
  const input = chat.getByLabel("Ask your CMO");
  await input.fill("Plan a launch week");
  await page.getByRole("region", { name: "Your team" }).getByRole("link", { name: /^Writer/ }).click();
  await expect(page).toHaveURL(/\/app\/writer/);
  await expect(input).toHaveValue("Plan a launch week");

  await page.goto("/app?ask=1&sample=1");
  await expect(input).toBeFocused();
  await expect(page).not.toHaveURL(/ask=1/);
});

test("look: the frame at 1440, 1280, 1024 and 390, with no serious axe violation", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await signIn(page, state().users.a);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [name, path, ready] of [
    ["dashboard", "/app?sample=1", "v2-dashboard"],
    ["writer", "/app/writer?sample=1", "v2-writer"],
    ["sales", "/app/sales?sample=1", "v2-sales"],
  ] as const) {
    for (const width of [1440, 1280, 1024, 390]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : width === 1024 ? 768 : 900 });
      await page.goto(path);
      // Visible only: during a navigation the outgoing page can briefly share the DOM with the new one.
      await expect(page.getByTestId(ready).filter({ visible: true })).toBeVisible();
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
      const overflow = await sidewaysOverflow(page);
      expect(overflow.width, `${name} @ ${width}, sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(width);
      await page.screenshot({ path: join(OUT, `${name}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/app/writer?sample=1");
  await expect(page.locator("#v2-chat").getByLabel("Ask your CMO")).toBeVisible();
  await page.screenshot({ path: join(OUT, "writer-1024-chat.png") });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app?sample=1");
  await expect(page.getByTestId("v2-dashboard")).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("the editor wears its artboard: Feed back, the Assistant in the right column, the CMO chat on the way back", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await signIn(page, state().users.a);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/studio");
  await page.getByTestId("studio-new").click();
  await page.getByTestId("new-slideshow").click();
  await expect(page).toHaveURL(/\/app\/editor\/[0-9a-f-]{36}/);

  const editor = page.getByTestId("editor-v2");
  await expect(editor).toBeVisible();
  // Editor.dc.html: the editor's own top bar, no frame bar above it.
  await expect(page.getByRole("banner").filter({ has: page.getByTestId("editor-home") })).toBeVisible();

  // One chat on screen: the clip's Assistant in the right column, none inside the editor.
  const column = page.getByRole("complementary", { name: "Assistant" });
  await expect(column.locator(".ed2-asst")).toBeVisible();
  await expect(editor.locator(".ed2-agent")).toBeHidden();
  await page.screenshot({ path: join(OUT, "editor-1440.png") });

  for (const [width, height] of [[1280, 800], [1024, 768]] as const) {
    await page.setViewportSize({ width, height });
    await expect(editor).toBeVisible();
    await page.screenshot({ path: join(OUT, `editor-${width}.png`) });
  }

  // "Feed" saves and goes back; the CMO chat is the feed's column again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("editor-home").click();
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.locator("#v2-chat").getByLabel("Ask your CMO")).toBeVisible();
});
