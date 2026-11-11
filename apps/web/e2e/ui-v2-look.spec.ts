import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * U9 look check: every v2 screen at 1440 and 390 on fixtures, plus axe. Screenshots land next to the frames in
 * docs/plans/cmo/2026-10-27-ui-build-frames/ for side-by-side review. Runs with `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-10-27-ui-build-frames");

/** Session B's screens; Session C appends its pages here as they land. */
const SCREENS: { name: string; path: string; ready: string }[] = [
  { name: "dashboard", path: "/app?sample=1", ready: "v2-dashboard" },
  { name: "design", path: "/app/design", ready: "v2-design" },
  { name: "inbox", path: "/app/inbox?sample=1", ready: "approval-queue" },
  { name: "inbox-card", path: "/app/inbox/card-post", ready: "inbox-card-page" },
  // P5 C0: the slideshow card on its fixture.
  { name: "inbox-card-slideshow", path: "/app/inbox/card-slideshow", ready: "inbox-card-page" },
  // Session C's pages on their fixtures (`?sample=1`), so the screenshots compare with the frames.
  ...["analytics", "research", "writer", "studio", "sales", "schedule", "settings", "setup"].map((name) => ({
    name,
    path: `/app/${name}?sample=1`,
    ready: `v2-${name}`,
  })),
  // Brain and Library are panes of the Context drawer over the feed (plan 2026-11-10-today-in-place).
  ...["plan", "learned", "voice", "skills"].map((pane) => ({ name: `drawer-${pane}`, path: `/app?doc=${pane}&sample=1`, ready: "v2-dashboard" })),
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
      // Screens read their data client-side: look (and run axe) once loading blocks are gone.
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
      const overflow = await sidewaysOverflow(page);
      expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(width);
      await page.screenshot({ path: join(OUT, `${screen.name}-${width}.png`), fullPage: true });

      // Next streams the page's metadata after its body: let the title land before axe reads it.
      await expect(page).toHaveTitle(/.+/);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  });
}
