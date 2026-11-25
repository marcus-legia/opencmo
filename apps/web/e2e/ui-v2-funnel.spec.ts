import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * The funnel (wave 3, C6): found, replied, answered back and signed up in the left panel (the week) and in Analytics
 * ("From a thread to a customer", per source), from `my_funnel`; Settings › Sales scans saves the cadence.
 * Screenshots: `test-results/funnel-*.png`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

test("the funnel in the left panel and Analytics, and the scan days in Settings", async ({ page }) => {
  test.setTimeout(120_000);
  const { url, service } = state();
  const db = createClient(url, service, { auth: { persistSession: false } });
  const email = `e2e-funnel-${randomUUID()}@test.local`;
  const password = `pw-${randomUUID()}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const userId = created.data.user!.id;
  expect((await db.from("marketing_documents").insert({ user_id: userId, ...ONBOARDING_DOCUMENT })).error).toBeNull();
  const now = new Date().toISOString();
  // Four found (three on Reddit, one on Hacker News), two replied to, one of them answered back, one signed up.
  const person = (i: number, platform: string, extra: Record<string, unknown> = {}) => ({
    user_id: userId,
    url: platform === "hn" ? `https://news.ycombinator.com/item?id=77${i}` : `https://www.reddit.com/r/SaaS/comments/e2efunnel${i}/x/`,
    platform,
    community: platform === "hn" ? "Ask HN" : "SaaS",
    title: `Thread ${i}`,
    score: 70,
    posted_at: now,
    // One insert of many rows: every row names the same columns (a missing one would be sent as null).
    status: "in_review",
    decided_at: null,
    person_status: "found",
    replied_at: null,
    status_at: null,
    ...extra,
  });
  const rows = [
    person(1, "reddit", { status: "replied", decided_at: now, person_status: "answered_back", replied_at: now, status_at: now }),
    person(2, "reddit", { status: "replied", decided_at: now, person_status: "signed_up", replied_at: now, status_at: now }),
    person(3, "reddit"),
    person(4, "hn"),
  ];
  expect((await db.from("opportunities").insert(rows)).error).toBeNull();

  await signIn(page, { email, password, id: userId });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/analytics");
  const steps = page.getByTestId("context-funnel").getByTestId("context-funnel-step");
  await expect(steps).toHaveText(["4Found", "2Replied", "2Answered back", "1Signed up"]);

  const funnel = page.getByTestId("analytics-funnel");
  await expect(funnel.getByRole("heading", { name: "From a thread to a customer" })).toBeVisible();
  await expect(funnel.getByTestId("analytics-funnel-step").nth(1)).toContainText("50% of found");
  const table = funnel.getByTestId("analytics-funnel-sources");
  await expect(table.getByRole("row", { name: /Reddit/ })).toContainText("3");
  await expect(table.getByRole("row", { name: /Hacker News/ })).toBeVisible();
  await page.screenshot({ path: "test-results/funnel-analytics-1440.png" });

  await page.goto("/app/settings#settings-sales-scans");
  const scans = page.getByTestId("settings-sales-scans");
  await expect(scans.getByRole("button", { name: /^Monday, Wednesday and Friday/ })).toHaveAttribute("aria-pressed", "true");
  await scans.getByRole("button", { name: /^Every weekday/ }).click();
  await expect(scans.getByRole("status")).toHaveText("Saved.");
  expect((await db.from("sales_settings").select("cadence").eq("user_id", userId).single()).data!.cadence).toBe("weekdays");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/analytics");
  await expect(page.getByTestId("analytics-funnel")).toBeVisible();
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/funnel-analytics-390.png", fullPage: true });
});
