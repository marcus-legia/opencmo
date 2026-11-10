import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * "System" follows the computer: with the OS in dark mode the v2 screens wear their artboards' dark tokens, also after
 * a client navigation into /app (the landing page's "Open app"), where the inline theme script does not run again.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);
test.use({ colorScheme: "dark" });

const background = (selector: string) =>
  `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`;

test("System in a dark OS: the app is dark after Open app, and Settings switches it to Light", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, state().users.a);
  await page.goto("/");
  await page.getByRole("link", { name: "Open app" }).first().click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The Main artboard's dark --bg is #121110.
  await expect.poll(() => page.evaluate(background(".k"))).toBe("rgb(18, 17, 16)");

  await page.goto("/app/settings");
  const appearance = page.getByTestId("settings-appearance");
  await appearance.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await appearance.getByRole("radio", { name: "System" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
