import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";

/**
 * U9 look check: every v2 screen at 1440 and 390 on fixtures, plus axe. Screenshots land next to the frames in
 * docs/plans/cmo/2026-10-27-ui-build-frames/ for side-by-side review. Runs with `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-10-27-ui-build-frames");

/** Session B's screens; Session C appends its pages here as they land. */
const SCREENS: { name: string; path: string; ready: string }[] = [
  { name: "dashboard", path: "/app?sample=1", ready: "v2-dashboard" },
  { name: "design", path: "/app/design", ready: "v2-design" },
  { name: "inbox", path: "/app/inbox?sample=1", ready: "approval-queue" },
  { name: "inbox-card", path: "/app/inbox/card-post", ready: "inbox-card-page" },
  // Session C's pages on their fixtures (`?sample=1`), so the screenshots compare with the frames.
  ...["analytics", "brain", "library", "research", "writer", "studio", "sales", "schedule", "settings", "setup"].map((name) => ({
    name,
    path: `/app/${name}?sample=1`,
    ready: `v2-${name}`,
  })),
];

for (const screen of SCREENS) {
  test(`${screen.name}: no serious axe violation, no page scroll at 390`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await signIn(page, state().users.a);
    // Robots and packets stop under reduced motion; screenshots then compare stable frames.
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      await page.goto(screen.path);
      await expect(page.getByTestId(screen.ready)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: join(OUT, `${screen.name}-${width}.png`), fullPage: true });

      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  });
}
